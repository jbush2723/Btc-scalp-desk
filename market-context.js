// BRTI is the contract's settlement reference; historical index movement is not a calibrated forecast.
// A 30-second opposing move is a conservative entry veto only, never an UP/DOWN trigger.
export function evaluateBrtiContext(feed,target){
 const unavailable={status:'unavailable',direction:'UNKNOWN',changePercent:null,distance:null,normalizedDistance:null,veto:false,reason:'No verified fresh BRTI snapshot.'};
 if(!feed||feed.status!=='live'||!Number.isFinite(feed.price)||feed.price<=0||!Number.isFinite(feed.ageMs)||feed.ageMs>5000)return unavailable;
 const distance=Number.isFinite(target)&&target>0?feed.price-target:null;
 const distancePct=distance===null?null:100*distance/target;
 const history=Array.isArray(feed.history)?feed.history.filter(x=>Number.isFinite(x.time)&&Number.isFinite(x.value)&&x.value>0&&x.time<=feed.sourceTime):[];
 const baseline=history.filter(x=>feed.sourceTime-x.time>=30000&&feed.sourceTime-x.time<=45000).at(-1);
 const changePercent=baseline?100*(feed.price-baseline.value)/baseline.value:null;
 const direction=changePercent===null?'UNKNOWN':changePercent>=0.025?'UP':changePercent<=-0.025?'DOWN':'FLAT';
 return {status:'live',direction,changePercent,distance,distancePct,reason:direction==='UNKNOWN'?'Collecting at least 30 seconds of BRTI index movement.':'Observed BRTI change over approximately 30 seconds.'};
}
export function applyBrtiVeto(reading,context){
 if(!['UP','DOWN'].includes(reading?.action))return reading;
 if(context?.status!=='live'||!['UP','DOWN'].includes(context.direction)||context.direction===reading.action)return reading;
 return {...reading,action:'SIT OUT',reason:'Official BRTI fell/rallied opposite the proposed '+reading.action+' contract scalp over ~30 seconds. Conflicting feeds: sit out.'};
}
