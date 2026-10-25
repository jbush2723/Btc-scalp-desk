// Illustrative price levels, not an optimized or backtested trading strategy.
export function priceGrid(ranges, side) {
  if(!Array.isArray(ranges)||!ranges.length)return [];
  const points=new Set();
  for(const r of ranges){
    const values=[r.start,r.end,r.step];
    if(values.some(v=>v===null||v===undefined||v===''))return [];
    const [start,end,step]=values.map(v=>Number(v)*10000);
    if(![start,end,step].every(Number.isFinite)||start<0||end>10000||end<=start||step<1||[start,end,step].some(v=>Math.abs(v-Math.round(v))>1e-6))return [];
    for(let p=Math.round(start);p<Math.round(end);p+=Math.round(step)){
      const value=side==='no'?10000-p:p;
      if(value>0&&value<10000)points.add(value);
    }
  }
  return [...points].sort((a,b)=>a-b);
}
export function suggestPlan({reading,quote,samples,market,now,costCents=null}) {
  const none=reason=>({available:false,reason});
  if(!['UP','DOWN'].includes(reading?.action))return none(reading?.reason||'Wait for a confirmed UP or DOWN signal.');
  if(!market?.ticker||!Number.isFinite(Date.parse(market.close_time))||Date.parse(market.close_time)-now<=60000)return none('No new entry in the final minute or after close.');
  if(costCents!==null&&(!Number.isFinite(costCents)||costCents<0||costCents>100))return none('Enter a cost allowance between 0 and 100¢ per contract, or leave it blank.');
  const side=reading.action==='UP'?'yes':'no';
  const ask=quote?.[side+'Ask'],bid=quote?.[side+'Bid'],size=quote?.[side+'AskSize'];
  if(!Number.isFinite(ask)||!Number.isFinite(bid)||ask<=0||ask>=1||bid<=0||bid>ask||ask-bid>.03000001||!Number.isFinite(size)||size<=0)return none('A valid two-sided quote with available ask size and a spread of 3¢ or less is required.');
  const history=samples.filter(s=>s.at>=now-36000&&s.at<=now&&Number.isFinite(s.mid));
  const latest=history.at(-1);
  if(history.length<8||!latest||now-latest.at>6000||latest.at-history[0].at<28000||history.some((s,i)=>i>0&&s.at-history[i-1].at>8000))return none('Need 30 seconds of uninterrupted recent quote history.');
  const grid=priceGrid(market.price_ranges,side);
  if(!grid.length)return none('Published price increments are unavailable; no order price suggested.');
  const ceil=value=>grid.find(p=>p>=value-1e-6), floor=value=>grid.findLast(p=>p<=value+1e-6);
  const entry=ceil(ask*10000);
  if(!entry||Math.abs(entry-ask*10000)>1e-6)return none('Current ask does not match the published price increments.');
  const mids=history.map(s=>side==='yes'?s.mid:1-s.mid);
  const range=Math.max(...mids)-Math.min(...mids);
  const distance=Math.max(.02,2*(ask-bid),range/2);
  const stop=floor(entry-distance*10000);
  if(!stop||stop>=bid*10000-1e-6)return none('Not enough room below the current bid for a valid stop reference.');
  const risk=entry-stop;
  if(risk>1000)return none('Recent movement requires more than 10¢ of price risk per contract.');
  const target=ceil(entry+2*risk);
  if(!target)return none('Too close to the payout ceiling for a 2:1 gross reward-to-risk target.');
  const reward=target-entry,cost=costCents===null?null:costCents*100;
  const netReward=cost===null?null:reward-cost,netRisk=cost===null?null:risk+cost;
  if(cost!==null&&(netReward<=0||netReward/netRisk<1.5))return none('The cost allowance leaves less than 1.5:1 estimated net reward-to-risk.');
  return {available:true,side,ticker:market.ticker,at:now,entry:entry/10000,stop:stop/10000,target:target/10000,
    risk:risk/10000,reward:reward/10000,ratio:reward/risk,netReward:netReward===null?null:netReward/10000,
    netRisk:netRisk===null?null:netRisk/10000,netRatio:netReward===null?null:netReward/netRisk,costCents,size,range,
    reason:'Buy '+side.toUpperCase()+' only at or below the entry limit. Take profit and stop references use the bid for that same side.'};
}
export function planStatus(plan,{ticker,quote,fresh,seconds,action}) {
  if(plan.ticker!==ticker)return 'Previous contract — these frozen levels do not apply to the current market.';
  if(!fresh)return 'Feed stale or unavailable — frozen reference only; exit levels cannot be checked.';
  const bid=quote?.[plan.side+'Bid'];
  const ask=quote?.[plan.side+'Ask'];
  if(!Number.isFinite(bid)||!Number.isFinite(ask)||bid<0||ask>1||bid>ask)return 'No valid current bid/ask — exit levels cannot be checked.';
  if(bid<=plan.stop+1e-9)return 'Stop bid reached or crossed — review your exit. The stop is not an order or a guaranteed fill.';
  if(bid>=plan.target-1e-9)return 'Take-profit bid reached — review your exit and available size.';
  if(seconds<=60)return 'Final minute — review your exit before settlement; no new entry suggested.';
  if(action!==(plan.side==='yes'?'UP':'DOWN'))return 'Entry setup no longer confirmed — review the frozen plan; do not treat it as a new entry.';
  return 'Frozen reference · current '+plan.side.toUpperCase()+' bid '+(bid*100).toFixed(1)+'¢. No orders have been placed.';
}
