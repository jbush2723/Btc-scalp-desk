import {settlementProjection} from './settlement-forecast.js';

// A walk-forward replay, never a synthetic Kalshi trade or official settlement.
// At each historical decision point, the model sees ONLY BRTI observations up to that timestamp.
export function replaySettlementRounds({rounds=[],ticks=[],minutesBeforeClose=5}={}){
 const horizon=minutesBeforeClose*60000;
 const samples=ticks.map(t=>Array.isArray(t)?{time:t[0],value:t[1]}:t)
   .filter(t=>Number.isFinite(t.time)&&Number.isFinite(t.value)&&t.value>0)
   .sort((a,b)=>a.time-b.time);
 const results=[],skipped={};
 const skip=why=>{skipped[why]=(skipped[why]||0)+1;};
 for(const round of rounds){
  const closeAt=Number(round.closeAt),strike=Number(round.strike),openAt=Number(round.openAt)||closeAt-900000;
  if(!Number.isFinite(closeAt)||!Number.isFinite(strike)||strike<=0||!Number.isFinite(openAt)||closeAt<=openAt){skip('Invalid market data');continue;}
  const targetAt=closeAt-horizon;
  if(targetAt<=openAt+90000){skip('Insufficient time after market open');continue;}
  // A small tolerance allows known source times rather than fabricated interpolated prices.
  const before=samples.filter(p=>p.time<=targetAt);
  const spot=before.at(-1);
  const closeTick=samples.filter(p=>p.time<=closeAt&&p.time>=closeAt-5000).at(-1);
  if(!spot||targetAt-spot.time>2500){skip('No tick near prediction time');continue;}
  if(!closeTick){skip('No tick within 5s of close');continue;}
  const past=before.filter(p=>p.time>=spot.time-100000);
  const snapshot={status:'live',price:spot.value,sourceTime:spot.time,ageMs:0,history:past};
  const forecast=settlementProjection({snapshot,strike,closeAt,now:spot.time});
  if(!forecast.ready){skip('Insufficient continuous 90s history');continue;}
  const outcome=closeTick.value>strike?1:0;
  const direction=forecast.direction;
  const correct=direction==='TOO CLOSE'?null:(direction==='UP'?outcome===1:outcome===0);
  const naiveSide=spot.value>strike?1:0;
  results.push({ticker:round.ticker,at:spot.time,closeAt,strike,spot:spot.value,close:closeTick.value,
    pAbove:forecast.pAbove,predicted:forecast.center,direction,correct,outcome,naiveCorrect:naiveSide===outcome,
    brier:(forecast.pAbove-outcome)**2,rangeHit:closeTick.value>=forecast.low&&closeTick.value<=forecast.high});
 }
 const directional=results.filter(r=>r.correct!==null),wins=directional.filter(r=>r.correct).length;
 return {results,skipped,totalRounds:rounds.length,evaluated:results.length,callCount:directional.length,
  correct:wins,accuracy:directional.length?wins/directional.length:null,
  naiveAccuracy:results.length?results.filter(r=>r.naiveCorrect).length/results.length:null,
  brier:results.length?results.reduce((a,r)=>a+r.brier,0)/results.length:null,
  rangeCoverage:results.length?results.filter(r=>r.rangeHit).length/results.length:null};
}
function usd(v){return Number.isFinite(v)?'$'+v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';}
function percent(v){return v===null?'—':(100*v).toFixed(1)+'%';}
export function installHistoricalReplay(host,getHistory){
 const panel=document.createElement('section');panel.className='card history-replay';panel.id='historicalReplay';
 panel.innerHTML='<div class="section-head"><h2>Instant backtest · historical settlement replay</h2><span class="pill">NO LIVE TRADES</span></div><p class="small muted">Replays the unchanged experimental forecast from previously recorded BRTI ticks. The model sees only prices available at the simulated decision time (no future leakage). Each round is scored once using an observed closing BRTI tick, not a confirmed Kalshi settlement. No historical Kalshi bid/ask, fills, trading fees, or actual profit is implied.</p><div class="toolbar"><label for="replayHorizon">Predict before round closes</label><select id="replayHorizon"><option value="10">10 minutes</option><option value="5" selected>5 minutes</option><option value="2">2 minutes</option></select><button id="runHistoricalReplay" type="button">Run historical replay now</button></div><p id="replayStatus" role="status">Press Run to evaluate any previously recorded rounds immediately.</p><div class="grid replay-metrics"><div class="metric"><h3>Eligible rounds</h3><div class="big" id="replayN">—</div></div><div class="metric"><h3>Directional accuracy</h3><div class="big" id="replayWin">—</div></div><div class="metric"><h3>Naive spot-vs-strike baseline</h3><div class="big" id="replayBaseline">—</div></div><div class="metric"><h3>Probability Brier score ↓</h3><div class="big" id="replayBrier">—</div></div></div><div class="table-scroll"><table><thead><tr><th>Historical round</th><th>Price at prediction</th><th>Strike</th><th>Modeled UP</th><th>Prediction</th><th>Observed close</th><th>Correct?</th></tr></thead><tbody id="replayRows"></tbody></table></div><p class="small muted">Brier score: 0 is perfect, lower is better, 0.25 is a reference for a constant 50% forecast on binary outcomes. The official market contract may apply settlement rules that differ from this observed tick. Backtest performance does not prove a profitable strategy.</p>';
 host.insertAdjacentElement('afterend',panel);
 const $=id=>panel.querySelector('#'+id);
 $('runHistoricalReplay').onclick=()=>{
  const data=getHistory(),minutesBeforeClose=Number($('replayHorizon').value);
  const summary=replaySettlementRounds({...data,minutesBeforeClose});
  $('replayN').textContent=summary.evaluated+' / '+summary.totalRounds;
  $('replayWin').textContent=percent(summary.accuracy)+' ('+summary.correct+'/'+summary.callCount+' calls)';
  $('replayBaseline').textContent=percent(summary.naiveAccuracy);
  $('replayBrier').textContent=summary.brier===null?'—':summary.brier.toFixed(3);
  const reasons=Object.entries(summary.skipped).map(([reason,n])=>n+' '+reason.toLowerCase()).join('; ');
  $('replayStatus').textContent=summary.evaluated?
   'Replay complete: '+summary.evaluated+' usable independent rounds. '+(reasons?'Other rounds excluded: '+reasons+'.':''):
   'No usable complete rounds recorded yet. '+(reasons?'Reasons: '+reasons+'. ':'')+'This page cannot reconstruct missing BRTI ticks or historical Kalshi quotes. Keep collecting data or import a genuine historical dataset in a future extension.';
  const body=$('replayRows');body.replaceChildren();
  for(const row of summary.results.slice(-25).reverse()){
   const tr=document.createElement('tr');
   const fields=[new Date(row.closeAt).toLocaleString(),usd(row.spot),usd(row.strike),percent(row.pAbove),
    row.direction==='UP'?'YES / UP':row.direction==='DOWN'?'NO / DOWN':'WAIT',usd(row.close),
    row.correct===null?'WAIT':row.correct?'Correct':'Wrong'];
   for(const f of fields){const td=document.createElement('td');td.textContent=f;tr.append(td);}body.append(tr);
  }
 };
 return panel;
}
