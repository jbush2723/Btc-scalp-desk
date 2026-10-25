// Experimental normal-return projection. Never represents a calibrated forecast or settlement oracle.
// Produces no forecast until sufficient fresh, regularly spaced BRTI observations are available.
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
function normalCdf(x) {
  const z=Math.abs(x),t=1/(1+.2316419*z);
  const tail=Math.exp(-z*z/2)/Math.sqrt(2*Math.PI)*
    (t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429)))));
  return x>=0?1-tail:tail;
}
export function settlementProjection({snapshot,strike,closeAt,now=Date.now()}){
 const insufficient=reason=>({ready:false,reason});
 if(snapshot?.status!=='live'||!Number.isFinite(snapshot.price)||snapshot.price<=0||
    !Number.isFinite(snapshot.ageMs)||snapshot.ageMs>5000)return insufficient('Waiting for fresh official BRTI data.');
 if(!Number.isFinite(strike)||strike<=0||!Number.isFinite(closeAt)||closeAt<=now)return insufficient('No active 15-minute contract and published target.');
 const latest=Number.isFinite(snapshot.sourceTime)?snapshot.sourceTime:now;
 const raw=Array.isArray(snapshot.history)?snapshot.history.filter(x=>Number.isFinite(x.time)&&Number.isFinite(x.value)&&x.value>0&&x.time<=latest).sort((a,b)=>a.time-b.time):[];
 if(raw.length<12||latest-raw[0].time<90000)return insufficient('Collecting at least 90 seconds of real BRTI history before projecting.');
 // Sample close to every 10 seconds. Do not treat missing data as zero movement.
 const prices=[],intervals=[];
 for(let at=latest-90000;at<=latest;at+=10000){
  let chosen=null,best=Infinity;
  for(const point of raw){
   const delta=Math.abs(point.time-at);
   if(delta<best){chosen=point;best=delta;}
  }
  if(best>2500||!chosen)return insufficient('BRTI history has gaps; waiting for regular samples.');
  prices.push(chosen.value);intervals.push(chosen.time);
 }
 if(prices.length<10||new Set(intervals).size!==prices.length)return insufficient('Not enough independent BRTI samples.');
 const returns=prices.slice(1).map((p,i)=>Math.log(p/prices[i]));
 const mean=returns.reduce((a,b)=>a+b,0)/returns.length;
 const variance=returns.reduce((a,b)=>a+(b-mean)**2,0)/(returns.length-1);
 const sigma=Math.sqrt(variance);
 if(!Number.isFinite(sigma)||sigma<0.000001)return insufficient('Insufficient observed volatility for a useful projection.');
 const secondsLeft=(closeAt-now)/1000,steps=secondsLeft/10;
 // Momentum over 90 s is a noisy estimate. Limit extrapolation to half a modeled standard deviation.
 const rawDrift=mean*steps,dispersion=sigma*Math.sqrt(steps);
 const drift=clamp(rawDrift,-0.5*dispersion,0.5*dispersion);
 const center=snapshot.price*Math.exp(drift);
 const low=center*Math.exp(-1.645*dispersion),high=center*Math.exp(1.645*dispersion);
 const pAbove=clamp(1-normalCdf((Math.log(strike/snapshot.price)-drift)/dispersion),0,1);
 const direction=pAbove>=0.55?'UP':pAbove<=0.45?'DOWN':'TOO CLOSE';
 return {ready:true,center,low,high,pAbove,pBelow:1-pAbove,direction,secondsLeft,
  volatility10s:sigma,historySeconds:90,sourceTime:latest};
}
export function settlementEdge(projection,quotes){
 if(!projection?.ready||!quotes)return {side:null,reason:'Forecast or contract quotes unavailable.'};
 const side=projection.direction==='UP'?'YES':projection.direction==='DOWN'?'NO':null;
 if(!side)return {side:null,reason:'Forecast too close to the strike for a directional lean.'};
 const ask=quotes[side.toLowerCase()+'Ask'],bid=quotes[side.toLowerCase()+'Bid'];
 if(!Number.isFinite(ask)||!Number.isFinite(bid)||ask<=0||ask>=1||bid<0||bid>ask)return {side:null,reason:'No valid executable bid/ask quote.'};
 const modeled=side==='YES'?projection.pAbove:projection.pBelow;
 const edge=modeled-ask;
 return {side,ask,bid,modeled,edge,worthConsidering:edge>=0.10 && ask-bid<=0.03 && projection.secondsLeft>60,
 reason:edge>=0.10?'Modeled advantage before fees, not an established trading edge.':'Modeled odds do not exceed the entry ask by 10 percentage points.'};
}
