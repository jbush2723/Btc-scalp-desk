// Additional read-only diagnostics inspired by AstroTick (Apache-2.0).
// Does not alter the established live signal or initiate orders.
import {astroExperiment,weightedBookSkew,quadraticFee,feeAwareScalpGuard} from './astro-experiment.js';
export function installAstroDiagnostics(host){
 const panel=document.createElement('section');panel.className='card astro-experiment';
 panel.id='astroExperiment';
 panel.innerHTML=`<div class="section-head"><h2>AstroTick-inspired research · live order-book skew</h2>
 <span class="pill warn" id="astroBadge">EXPERIMENTAL</span></div>
 <p class="small muted">Independent test of 5-minute official BRTI momentum + top-10 Kalshi bid-depth imbalance. The 60/40 weighting and estimated probability adjustment are uncalibrated rules, not actual win probabilities. This panel does NOT change the primary BUY/WAIT signal or place orders.</p>
 <div class="grid astro-live-grid">
 <div class="metric"><h3>Experimental direction</h3><div class="big" id="astroAction">WAIT</div></div>
 <div class="metric"><h3>Weighted book skew (YES vs NO)</h3><div class="big" id="astroSkew">—</div></div>
 <div class="metric"><h3>Observed BRTI 5m change</h3><div class="big" id="astroMomentum">—</div></div>
 <div class="metric"><h3>Heuristic YES odds (not calibrated)</h3><div class="big" id="astroHeuristic">—</div></div>
 </div>
 <p class="small" id="astroReason">Waiting for five minutes of observed BRTI history and depth.</p>
 <p class="small muted" id="astroFees">Quadratic taker-fee estimate: awaiting an available entry price.</p>
 <p class="small muted" id="astroRisk">Example $50 fee-aware plan check: waiting for confirmed plan.</p>
 <p class="small muted">AstroTick source: <a href="https://github.com/Razzleberryss/AstroTick" target="_blank" rel="noopener noreferrer">Razzleberryss/AstroTick (Apache-2.0)</a>. Candidate comparison is paper-only; no entries are automatically enabled.</p>`;
 host.insertAdjacentElement('afterend',panel);
 const $=id=>panel.querySelector('#'+id);
 const num=n=>Number.isFinite(n)?(n>=0?'+':'')+n.toFixed(2):'—';
 function update({book,quote,brtiTicks,now=Date.now(),closeAt,plan,fresh=false}={}){
  if(!fresh){
   $('astroBadge').textContent='DATA UNAVAILABLE';$('astroAction').textContent='WAIT';
   $('astroReason').textContent='Waiting for fresh two-sided Kalshi order-book and BRTI observations.';
   for(const id of ['astroSkew','astroMomentum','astroHeuristic'])$(id).textContent='—';
   $('astroFees').textContent='Fees unavailable without a fresh executable ask.';
   $('astroRisk').textContent='Risk evaluation paused until live data is fresh.';
   return;
  }
  const skew=weightedBookSkew(book);
  const s=astroExperiment({book,quote,brtiTicks,now,closeAt});
  $('astroAction').textContent=s.action==='UP'?'PAPER YES CANDIDATE':s.action==='DOWN'?'PAPER NO CANDIDATE':'WAIT';
  $('astroAction').className='big '+(s.action==='UP'?'up':s.action==='DOWN'?'down':'warn');
  $('astroBadge').textContent='EXPERIMENTAL';
  $('astroSkew').textContent=skew?num(skew.skew*100)+'%':'—';
  $('astroMomentum').textContent=Number.isFinite(s.indexChangePct)?num(s.indexChangePct)+'%':'—';
  $('astroHeuristic').textContent=Number.isFinite(s.heuristicPYes)?
   (100*s.heuristicPYes).toFixed(1)+'%':'—';
  $('astroReason').textContent=s.reason;
  const side=['yes','no'].includes(s.side)?s.side:plan?.available?plan.side:null;
  const ask=side&&quote?.[side+'Ask'],available=side&&quote?.[side+'AskSize'];
  if(Number.isFinite(ask)&&ask>0&&ask<1&&Number.isFinite(available)&&available>0){
   let qty=Math.floor(Math.min(available,50/ask));
   while(qty>0&&qty*ask+quadraticFee(qty,ask) >50)qty--;
   const entry=qty>0?quadraticFee(qty,ask):null;
   const hypotheticalClose=qty>0?quadraticFee(qty,.5):null;
   $('astroFees').textContent=qty>0?'Illustrative $50 stake · '+side.toUpperCase()+
    ' buy '+qty+' contracts at '+(ask*100).toFixed(1)+'¢: estimated quadratic open fee $'+
    entry.toFixed(2)+'; worst-case 50¢ close fee $'+hypotheticalClose.toFixed(2)+
    '. Actual fees depend on venue schedule and fill price.':
    'Not enough stake or book quantity to estimate an entry.';
  }else $('astroFees').textContent='No usable ask or size for a quadratic fee estimate.';
  const gate=feeAwareScalpGuard(plan,quote,{stake:50,balance:1000,maxExposure:50});
  $('astroRisk').textContent=gate.allowed?
   'Existing plan, separate fee/risk audit: '+gate.qty+' contracts · estimated net target $'+
    gate.netTarget.toFixed(2)+' · net reward/risk '+gate.netRatio.toFixed(2)+
    ':1 · illustrative limits: $50 exposure, $100 daily loss, 10 trades/day in paper comparison.':
   'Existing plan, separate fee/risk audit: '+gate.reason+
    ' These extra checks do not override your main live signal.';
 }
 update();
 return {panel,update};
}
