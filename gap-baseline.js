// Paper-only, independently implemented zero-drift averaged-settlement baseline.
// Research context: schen9999/btc-15m-engine M0 and darup67/kalshi-btc-agent.
// Unlike those repositories, this implementation uses observed official BRTI,
// a short rolling 5-minute historical volatility estimate and NO fitted calibration.
// DO NOT reuse their published hit rates for these computed probabilities.
import {quadraticFee} from './astro-experiment.js';

const finite=x=>typeof x==='number'&&Number.isFinite(x);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

export function normalCdf(x){
 if(!finite(x))return null;
 const z=Math.abs(x),t=1/(1+.2316419*z);
 const tail=Math.exp(-z*z/2)/Math.sqrt(2*Math.PI)*
   (t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429)))));
 return clamp(x>=0?1-tail:tail,0,1);
}

// The BRTI price is sampled at 10-second spacing, NOT interpolated.
// Refuse sparse data rather than turning stale or absent points into volatility.
export function observedVolatility(ticks,sourceTime,{lookbackMs=300000,stepMs=10000,toleranceMs=3000}={}){
 if(!Array.isArray(ticks)||!finite(sourceTime))return null;
 const rows=ticks.filter(x=>finite(x?.time)&&finite(x?.value)&&x.value>0&&
   x.time<=sourceTime&&x.time>=sourceTime-lookbackMs-toleranceMs)
   .sort((a,b)=>a.time-b.time);
 const values=[],times=[];
 for(let at=sourceTime-lookbackMs;at<=sourceTime;at+=stepMs){
  let best=null,delta=Infinity;
  for(const p of rows){const d=Math.abs(p.time-at);if(d<delta){best=p;delta=d;}}
  if(!best||delta>toleranceMs||times.includes(best.time))return null;
  values.push(best.value);times.push(best.time);
 }
 if(values.length<31)return null;
 const changes=values.slice(1).map((p,i)=>Math.log(p/values[i]));
 const mean=changes.reduce((s,v)=>s+v,0)/changes.length;
 const variance=changes.reduce((s,v)=>s+(v-mean)**2,0)/(changes.length-1);
 const sigma1s=Math.sqrt(Math.max(variance/ (stepMs/1000),0));
 if(!finite(sigma1s)||sigma1s<1e-8)return null;
 return {sigma1s,samples:values.length,historySeconds:lookbackMs/1000,
   earliest:times[0],latest:times.at(-1)};
}

export function gapProbability({snapshot,strike,closeAt,now=Date.now()}={}){
 const unavailable=reason=>({ready:false,reason,pYes:null,pNo:null});
 if(snapshot?.status!=='live'||!finite(snapshot.price)||snapshot.price<=0||
   !finite(snapshot.sourceTime)||!finite(snapshot.ageMs)||snapshot.ageMs<0||
   snapshot.ageMs>5000||now-snapshot.sourceTime>8000||snapshot.sourceTime>now+2000)
  return unavailable('Need fresh official BRTI observations.');
 if(!finite(strike)||strike<=0||!finite(closeAt)||closeAt<=now)
  return unavailable('Need a current contract with a published strike and close time.');
 const secondsLeft=(closeAt-now)/1000;
 // The partial settlement average is not available at one-second resolution
 // in older recorded rounds. Do not pretend the final minute is modeled.
 if(secondsLeft<=60)return unavailable('Inside final settlement minute: partial BRTI average not modeled.');
 const vol=observedVolatility(snapshot.history,snapshot.sourceTime);
 if(!vol)return unavailable('Need five continuous minutes of observed BRTI with regular 10-second samples.');
 const varTime=secondsLeft-40; // variance-equivalent horizon for a final 60s mean
 const driftTime=secondsLeft-30;
 const dispersion=vol.sigma1s*Math.sqrt(varTime);
 const d=(Math.log(snapshot.price/strike)-.5*vol.sigma1s**2*driftTime)/dispersion;
 const pYes=clamp(normalCdf(d),1e-6,1-1e-6);
 return {ready:true,pYes,pNo:1-pYes,secondsLeft,sourceTime:snapshot.sourceTime,
  spot:snapshot.price,strike,gapUsd:snapshot.price-strike,cushionSigma:d,
  sigma1s:vol.sigma1s,historySeconds:vol.historySeconds,samples:vol.samples,
  reason:'Zero-drift lognormal approximation for the final-minute averaged settlement; uncalibrated.'};
}

// Selects NO PAPER CALL unless BOTH the probability threshold and an
// estimated settlement EV check pass. EV is NOT a seven-minute scalp forecast.
// A real scalp pays an additional exit fee and can suffer adverse execution.
export function gapConfidenceGate(model,quote,{minProbability=.95,minNetSettlementEv=.02,maxSpread=.03,feeRate=.07}={}){
 const blocked=reason=>({...model,action:'WAIT',side:null,reason,
   netSettlementEv:null,entryAsk:null,entryFee:null});
 if(!model?.ready)return blocked(model?.reason||'No model probability available.');
 if(!quote)return blocked('Need a fresh two-sided Kalshi quote.');
 const side=model.pYes>=.5?'yes':'no',pWin=side==='yes'?model.pYes:model.pNo;
 if(pWin<minProbability)return blocked('Modeled confidence below the 95% research threshold.');
 const bid=quote[side+'Bid'],ask=quote[side+'Ask'],size=quote[side+'AskSize'];
 if(!finite(bid)||!finite(ask)||bid<0||ask<=0||ask>=1||bid>ask||
   !finite(size)||size<1)return blocked('Missing executable-side bid, ask, or displayed size.');
 if(ask-bid>maxSpread+1e-9)return blocked('Spread wider than the 3-cent research maximum.');
 const entryFee=quadraticFee(1,ask,feeRate);
 if(!finite(entryFee))return blocked('Could not estimate the entry fee.');
 const netSettlementEv=pWin-ask-entryFee;
 if(netSettlementEv<minNetSettlementEv)return {...blocked('No estimated 2-cent settlement edge after entry fee.'),
   netSettlementEv,entryAsk:ask,entryFee};
 return {...model,action:side==='yes'?'UP':'DOWN',side,
   modeledWinProbability:pWin,entryAsk:ask,entryFee,netSettlementEv,
   reason:'PAPER CANDIDATE ONLY: model probability and settlement-only fee gate pass. Scalp return and real fills are not established.'};
}
