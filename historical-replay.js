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
// Illustrative account path on real observed directional calls with USER-ASSUMED contract prices.
// Never label these financial marks as actual Kalshi backtested fills.
export function hypotheticalBankroll(results,{initial=1000,maxStake=50,askCents=50,feeCents=1}={}){
 const params=[initial,maxStake,askCents,feeCents];
 if(params.some(x=>!Number.isFinite(x))||initial<=0||maxStake<=0||askCents<=0||askCents>=100||feeCents<0||feeCents>30)
   return {valid:false,reason:'Choose a positive starting balance and stake, an entry from 1–99¢, and a fee allowance from 0–30¢ per contract.'};
 const cost=(askCents+feeCents)/100,rows=[];
 let cash=initial,peak=initial,maxDrawdown=0,profitCount=0,lossCount=0,totalFees=0;
 for(const r of results){
  if(r.correct===null||typeof r.correct!=='boolean')continue;
  const contracts=Math.min(100000,Math.floor(Math.min(maxStake,cash)/cost));
  if(contracts<1)break;
  const paid=contracts*cost;
  const payout=r.correct?contracts:0;
  const gain=payout-paid;
  cash+=gain;
  totalFees+=contracts*feeCents/100;
  if(r.correct)profitCount++;else lossCount++;
  peak=Math.max(peak,cash);
  maxDrawdown=Math.max(maxDrawdown,peak>0?(peak-cash)/peak:0);
  rows.push({ticker:r.ticker,contracts,paid,payout,gain,balance:cash,correct:r.correct});
 }
 return {valid:true,initial,balance:cash,profit:cash-initial,maxDrawdown,profitCount,lossCount,totalFees,trades:rows.length,rows};
}
function usd(v){return Number.isFinite(v)?'$'+v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';}
function percent(v){return v===null?'—':(100*v).toFixed(1)+'%';}
export function installHistoricalReplay(host,getHistory){
 const panel=document.createElement('section');panel.className='card history-replay';panel.id='historicalReplay';
 panel.innerHTML='<div class="section-head"><h2>Instant backtest · historical settlement replay</h2><span class="pill">NO LIVE TRADES</span></div><p class="small muted">Replays the unchanged experimental forecast from previously recorded BRTI ticks. The model sees only prices available at the simulated decision time (no future leakage). Each round is scored once using an observed closing BRTI tick, not a confirmed Kalshi settlement. No historical Kalshi bid/ask, fills, trading fees, or actual profit is implied.</p><div class="toolbar"><label for="replayHorizon">Predict before round closes</label><select id="replayHorizon"><option value="10">10 minutes</option><option value="5" selected>5 minutes</option><option value="2">2 minutes</option></select><button id="runHistoricalReplay" type="button">Run historical replay now</button></div><p id="replayStatus" role="status">Press Run to evaluate any previously recorded rounds immediately.</p><div class="grid replay-metrics"><div class="metric"><h3>Eligible rounds</h3><div class="big" id="replayN">—</div></div><div class="metric"><h3>Directional accuracy</h3><div class="big" id="replayWin">—</div></div><div class="metric"><h3>Naive spot-vs-strike baseline</h3><div class="big" id="replayBaseline">—</div></div><div class="metric"><h3>Probability Brier score ↓</h3><div class="big" id="replayBrier">—</div></div></div><div class="table-scroll"><table><thead><tr><th>Historical round</th><th>Price at prediction</th><th>Strike</th><th>Modeled UP</th><th>Prediction</th><th>Observed close</th><th>Correct?</th></tr></thead><tbody id="replayRows"></tbody></table></div><div class="scenario-card"><h3>$1,000 account · settlement what-if</h3><p class="small muted">Uses actual recorded forecast directions, but a HYPOTHETICAL fixed purchase ask and fee allowance. Past executable Kalshi asks and official settlements are unavailable here. This is scenario math, not historical trade profitability or a validated strategy.</p><div class="grid scenario-inputs"><label>Starting bankroll ($)<input id="scenarioBankroll" type="number" min="10" max="1000000" step="10" value="1000"></label><label>Maximum stake per round ($)<input id="scenarioStake" type="number" min="1" max="10000" step="1" value="50"></label><label>Assumed YES/NO buy price (¢)<input id="scenarioAsk" type="number" min="1" max="99" step="1" value="50"></label><label>Assumed fee per contract (¢)<input id="scenarioFee" type="number" min="0" max="30" step=".1" value="1"></label></div><div class="grid replay-metrics"><div class="metric"><h3>Hypothetical end balance</h3><div class="big" id="scenarioEnd">—</div></div><div class="metric"><h3>Hypothetical profit/loss</h3><div class="big" id="scenarioProfit">—</div></div><div class="metric"><h3>Completed calls used</h3><div class="big" id="scenarioTrades">—</div></div><div class="metric"><h3>Hypothetical max drawdown</h3><div class="big" id="scenarioDrawdown">—</div></div></div><p id="scenarioCaveat" class="small muted">Run a historical replay to calculate the what-if. No sample trades are generated.</p></div><p class="small muted">Brier score: 0 is perfect, lower is better, 0.25 is a reference for a constant 50% forecast on binary outcomes. The official market contract may apply settlement rules that differ from this observed tick. Backtest performance does not prove a profitable strategy.</p>';
 host.insertAdjacentElement('afterend',panel);
 const $=id=>panel.querySelector('#'+id);
 for(const id of ['scenarioBankroll','scenarioStake','scenarioAsk','scenarioFee']) $(''+id).addEventListener('change',()=>{if($('replayN').textContent!=='—')$('runHistoricalReplay').click();});
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
  const bankroll=hypotheticalBankroll(summary.results,{
    initial:Number($('scenarioBankroll').value),maxStake:Number($('scenarioStake').value),
    askCents:Number($('scenarioAsk').value),feeCents:Number($('scenarioFee').value)
  });
  $('scenarioEnd').textContent=bankroll.valid&&bankroll.trades?usd(bankroll.balance):'—';
  $('scenarioProfit').textContent=bankroll.valid&&bankroll.trades?(bankroll.profit>=0?'+':'')+usd(bankroll.profit):'—';
  $('scenarioTrades').textContent=bankroll.valid?String(bankroll.trades):'—';
  $('scenarioDrawdown').textContent=bankroll.valid&&bankroll.trades?percent(bankroll.maxDrawdown):'—';
  $('scenarioCaveat').textContent=!bankroll.valid?bankroll.reason:
    !bankroll.trades?'No completed independent historical directional calls available. No returns can be estimated.':
    'Illustrative only: '+bankroll.profitCount+' positive / '+bankroll.lossCount+' negative round predictions at assumed '+$('scenarioAsk').value+
    '¢ entry, '+$('scenarioFee').value+'¢ fee per contract. Total modeled fees '+usd(bankroll.totalFees)+'. These were NOT verified executable trades.';
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
