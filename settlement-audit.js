// Browser-local paper log of higher-risk 15-minute settlement projections.
// Outcomes are inferred only from fresh observed BRTI ticks close to round expiry.
// Does not assert official Kalshi settlement; excludes unavailable results from scorecards.
const KEY='btcSettlementForecastAuditV1';
const stages=[{key:'early',label:'First valid'},{key:'5m',label:'5 min left'},{key:'2m',label:'2 min left'}];
const esc=v=>String(v);
function load(){try{const v=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(v)?v.slice(-150):[];}catch{return [];}}
const pct=v=>Number.isFinite(v)?(100*v).toFixed(1)+'%':'—';
export function startSettlementAudit(){
 const section=document.createElement('section');
 section.id='settlementAudit';section.className='card';
 section.innerHTML='<div class="section-head"><h2>Riskier strategy · settlement prediction audit</h2><span id="settlementAuditCount" class="pill">0 evaluated</span></div><p class="small muted">Each round records the first usable forecast, plus a snapshot near 5 minutes and 2 minutes remaining when available. Predictions are frozen before results. Outcome comparison uses only a BRTI observation within five seconds of the close and does not verify the official Kalshi settlement. Missing observations are excluded; quoted model probabilities are not proven win rates.</p><p id="settlementAuditStats" class="small">Collecting forecast records.</p><div class="table-scroll"><table><thead><tr><th>Round ends</th><th>Forecast time</th><th>Lean</th><th>Modeled confidence</th><th>Predicted close</th><th>Strike</th><th>Observed finish</th><th>Paper result</th></tr></thead><tbody id="settlementAuditRows"></tbody></table></div><button id="settlementAuditExport" type="button" class="secondary">Download forecasts CSV</button>';
 let records=load(),lastSaved=0,lastRender=0;
 const header=['ticker','snapshot_stage','forecast_time_utc','round_close_utc','strike','brti_at_forecast','predicted_close','modeled_probability_above','lean','observed_close','observed_at_utc','paper_correct','outcome_status'];
 section.querySelector('#settlementAuditExport').onclick=()=>{
  const out=[header,...records.map(r=>[r.ticker,r.stage,new Date(r.at).toISOString(),new Date(r.closeAt).toISOString(),r.strike,r.spot,r.predicted,r.probAbove,r.lean,r.observed??'',r.observedAt?new Date(r.observedAt).toISOString():'',r.correct??'',r.status])];
  const csv=out.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download='btc-settlement-forecast-audit.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 const money=v=>Number.isFinite(v)?'$'+v.toLocaleString('en-US',{maximumFractionDigits:2,minimumFractionDigits:2}):'—';
 function observe({market,forecast,ticks=[],snapshot,now=Date.now()}={}){
  const closeAt=Date.parse(market?.close_time),strike=Number(market?.floor_strike),ticker=market?.ticker;
  if(forecast?.ready&&ticker&&Number.isFinite(closeAt)&&Number.isFinite(strike)&&strike>0&&closeAt>now&&snapshot?.status==='live'){
   const left=(closeAt-now)/1000;
   for(const stage of stages){
    if(stage.key==='5m'&&(left>300||left<240))continue;
    if(stage.key==='2m'&&(left>120||left<60))continue;
    if(records.some(r=>r.ticker===ticker&&r.stage===stage.key))continue;
    records.push({ticker,stage:stage.key,at:now,closeAt,strike,spot:snapshot.price,predicted:forecast.center,
      probAbove:forecast.pAbove,lean:forecast.direction,status:'pending',observed:null,observedAt:null,correct:null});
   }
  }
  for(const r of records){
   if(r.status!=='pending'||now<r.closeAt)continue;
   const closeTick=ticks.filter(t=>t.time<=r.closeAt&&t.time>=r.closeAt-5000).sort((a,b)=>b.time-a.time)[0];
   if(closeTick){
    r.observed=closeTick.value;r.observedAt=closeTick.time;
    r.status='observed_unconfirmed';
    r.correct=r.lean==='TOO CLOSE'?null:r.lean==='UP'?closeTick.value>r.strike:closeTick.value<r.strike;
   }else if(now>r.closeAt+120000){r.status='missing_close_data';}
  }
  records=records.slice(-150);
  if(now-lastSaved>=10000){try{localStorage.setItem(KEY,JSON.stringify(records));}catch{}lastSaved=now;}
  if(now-lastRender<4000)return;
  lastRender=now;
  const tested=records.filter(r=>r.status==='observed_unconfirmed'&&typeof r.correct==='boolean');
  const won=tested.filter(r=>r.correct).length;
  const pending=records.filter(r=>r.status==='pending').length;
  section.querySelector('#settlementAuditCount').textContent=tested.length+' evaluated';
  section.querySelector('#settlementAuditStats').textContent=
   'Observed directional accuracy: '+(tested.length?won+'/'+tested.length+' ('+pct(won/tested.length)+')':'Not enough observations')+
   ' · pending '+pending+' · missing close observations '+records.filter(r=>r.status==='missing_close_data').length+
   '. Multiple forecasts from the same round are correlated, not independent tests.';
  const body=section.querySelector('#settlementAuditRows');body.replaceChildren();
  for(const r of records.slice(-12).reverse()){
   const tr=document.createElement('tr');
   const confidence=r.lean==='UP'?r.probAbove:r.lean==='DOWN'?1-r.probAbove:null;
   const values=[new Date(r.closeAt).toLocaleTimeString(),r.stage+' · '+new Date(r.at).toLocaleTimeString(),r.lean,pct(confidence),money(r.predicted),money(r.strike),money(r.observed),
    r.correct===true?'Observed correct':r.correct===false?'Observed wrong':r.status==='pending'?'Pending':r.status==='missing_close_data'?'No closing tick':'No directional call'];
   for(const value of values){const cell=document.createElement('td');cell.textContent=esc(value);tr.append(cell);}
   body.append(tr);
  }
 }
 return {section,observe};
}
