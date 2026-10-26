// AstroTick-inspired experimental signals and risk gates.
// Original: https://github.com/Razzleberryss/AstroTick (Apache-2.0).
// Adapted independently for read-only BTC15M scalp research; NOT a trained
// probability model, NOT proof of positive EV, and NEVER places live orders.

const finite=x=>typeof x==='number'&&Number.isFinite(x);
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const validPrice=p=>finite(p)&&p>0&&p<1;

export function weightedBookSkew(book,levels=10){
 if(!book||!Array.isArray(book.yes)||!Array.isArray(book.no))return null;
 const depth=rows=>rows.filter(r=>Array.isArray(r)&&validPrice(r[0])&&finite(r[1])&&r[1]>0)
  .sort((a,b)=>b[0]-a[0]).slice(0,levels);
 const yes=depth(book.yes),no=depth(book.no);
 if(!yes.length||!no.length)return null; // unknown skew, not zero skew
 const weighted=rows=>rows.reduce((sum,[p,size])=>sum+p*100*size,0);
 const yesWeight=weighted(yes),noWeight=weighted(no),total=yesWeight+noWeight;
 if(!total)return null;
 return {skew:(yesWeight-noWeight)/total,yesWeight,noWeight,
  yesBest:yes[0],noBest:no[0],yesDepth:yes.reduce((s,r)=>s+r[1],0),
  noDepth:no.reduce((s,r)=>s+r[1],0),levelsYes:yes.length,levelsNo:no.length};
}
export function quadraticFee(contracts,price,feeRate=.07){
 if(!Number.isInteger(contracts)||contracts<1||!validPrice(price)||!finite(feeRate)||feeRate<0||feeRate>1)return null;
 // Standard Kalshi quadratic taker-fee proxy: round UP to next whole cent.
 // Fee schedules/market fee_type can change; this is not a quoted exchange fee.
 return Math.ceil(feeRate*contracts*price*(1-price)*100-1e-10)/100;
}
export function indexMomentum(ticks,now,{lookbackMs=300000,toleranceMs=30000}={}){
 if(!Array.isArray(ticks)||!finite(now))return null;
 const valid=ticks.filter(x=>finite(x?.time)&&finite(x?.value)&&x.value>0&&x.time<=now)
  .sort((a,b)=>a.time-b.time);
 const latest=valid.at(-1);
 if(!latest||now-latest.time>8000)return null;
 const baseline=valid.filter(x=>x.time<=latest.time-lookbackMs&&
  x.time>=latest.time-lookbackMs-toleranceMs).at(-1);
 if(!baseline)return null;
 const change=(latest.value-baseline.value)/baseline.value;
 return {rawChangePct:change*100,normalized:clamp(change/.02,-1,1),
  baselineAt:baseline.time,lastAt:latest.time};
}
export function astroExperiment({book,quote,brtiTicks,now=Date.now(),closeAt=null,feeRate=.07,
 maxSpread=.03,minEdge=.10,maxDeviation=.20,minNetEv=.02}={}){
 const out={action:'WAIT',ready:false,reason:'Waiting for observed book levels and five minutes of settlement-index history.',
  score:null,skew:null,indexChangePct:null,heuristicPYes:null,edge:null,feePerContract:null};
 if(!finite(now)||!finite(closeAt)||closeAt-now<=60000)return {...out,reason:'No experimental entries in the final minute.'};
 const weighted=weightedBookSkew(book),momentum=indexMomentum(brtiTicks,now);
 if(!weighted||!momentum)return out;
 if(!quote||!validPrice(quote.yesBid)||!validPrice(quote.yesAsk)||quote.yesAsk<quote.yesBid)
  return {...out,reason:'Two-sided live bid and ask are required.'};
 const spread=quote.yesAsk-quote.yesBid;
 const result={...out,ready:true,skew:weighted.skew,indexChangePct:momentum.rawChangePct,
  yesWeight:weighted.yesWeight,noWeight:weighted.noWeight,
  score:clamp(.6*momentum.normalized+.4*weighted.skew,-1,1)};
 if(spread>maxSpread+1e-9)return {...result,reason:'Kalshi YES spread exceeds the 3¢ scalp limit.'};
 const mid=(quote.yesBid+quote.yesAsk)/2;
 const heuristicPYes=clamp(mid+.5*result.score,.01,.99);
 const direction=result.score>0?'UP':result.score<0?'DOWN':null;
 const side=direction==='UP'?'yes':'no';
 const entry=quote[side+'Ask'],bid=quote[side+'Bid'];
 const price=side==='yes'?entry:1-entry; // YES-equivalent for NO fee-aware math
 const diff=heuristicPYes-price;
 const edge=direction==='UP'?diff:-diff;
 const enriched={...result,heuristicPYes,edge,side};
 if(!direction||!validPrice(entry)||!validPrice(bid)||!finite(quote[side+'AskSize'])||quote[side+'AskSize']<1)
  return {...enriched,reason:'No valid entry-side price or displayed ask size.'};
 if(weighted[side+'Best'][1]<5)return {...enriched,reason:'Best-bid depth below 5 contracts.'};
 if(Math.abs(heuristicPYes-mid)>maxDeviation)return {...enriched,reason:'Heuristic deviation from market midpoint exceeds 20 percentage points.'};
 if(edge<minEdge)return {...enriched,reason:'Heuristic market-versus-entry edge is below 10 percentage points.'};
 if(price>.35&&price<.56)return {...enriched,reason:'YES-equivalent entry price is inside the experimental 35–56¢ fee-sensitive band.'};
 // EV calculation compares hypothetical *settlement* payoff to the entry ask.
 // It is an exploratory filter only, NOT a forecast of seven-minute exit returns.
 const openFee=quadraticFee(1,entry,feeRate),closeFee=quadraticFee(1,.5,feeRate);
 const modelWinProbability=side==='yes'?heuristicPYes:1-heuristicPYes;
 const netEv=modelWinProbability-entry-openFee-closeFee;
 if(netEv<minNetEv)return {...enriched,netEv,reason:'Heuristic settlement EV after quadratic fees is below 2¢/contract.'};
 return {...enriched,action:direction,netEv,feePerContract:openFee+closeFee,
  reason:'EXPERIMENT ONLY: index momentum and weighted 10-level book skew pass heuristic, spread, depth and fee filters. No validated probability or seven-minute edge.'};
}
export function feeAwareScalpGuard(plan,quote,{stake=50,balance=1000,feeRate=.07,
 maxExposure=50,minNetRewardPerContract=.02,minNetRatio=1.5}={}){
 const failure=reason=>({allowed:false,reason});
 if(!plan?.available||!['yes','no'].includes(plan.side))return failure('No qualifying price plan.');
 if(!finite(stake)||!finite(balance)||!finite(maxExposure)||stake<=0||balance<=0||maxExposure<=0)
  return failure('Risk limits invalid.');
 const ask=quote?.[plan.side+'Ask'],available=quote?.[plan.side+'AskSize'],bid=quote?.[plan.side+'Bid'];
 if(!validPrice(ask)||!validPrice(bid)||bid>ask||!finite(available)||available<1||ask>plan.entry+1e-9)
  return failure('Ask, spread or displayed liquidity invalid.');
 const cap=Math.floor(Math.min(available,Math.min(stake,maxExposure,balance)/ask));
 if(cap<1)return failure('Stake/exposure cannot cover one contract.');
 let qty=cap,openFee,closeFee;
 while(qty>0){
  openFee=quadraticFee(qty,ask,feeRate);
  if(qty*ask+openFee<=Math.min(stake,maxExposure,balance)+1e-9)break;
  qty--;
 }
 if(qty<1)return failure('Stake cannot cover the entry plus estimated fee.');
 if(!validPrice(plan.target)||!validPrice(plan.stop)||plan.target<=ask||plan.stop>=ask)
  return failure('Invalid stop or target.');
 closeFee=quadraticFee(qty,plan.target,feeRate);
 const stopFee=quadraticFee(qty,plan.stop,feeRate);
 const netTarget=qty*(plan.target-ask)-openFee-closeFee;
 const netStopRisk=qty*(ask-plan.stop)+openFee+stopFee;
 const netRatio=netStopRisk>0?netTarget/netStopRisk:0;
 if(netTarget/qty<minNetRewardPerContract||netRatio<minNetRatio)
  return failure('After estimated fees, target edge or reward-to-risk is too small.');
 return {allowed:true,qty,openFee,estimatedTargetExitFee:closeFee,netTarget,
  netStopRisk,netRatio,commitment:qty*ask+openFee,feeRate};
}