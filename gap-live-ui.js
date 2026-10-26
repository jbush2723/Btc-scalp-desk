// Live display only; the original entry engine and paper exit monitor are unchanged.
import {gapProbability,gapConfidenceGate} from './gap-baseline.js';
export function installGapDiagnostics(host){
 const panel=document.createElement('section');
 panel.className='card astro-experiment';panel.id='gapBaseline';
 panel.innerHTML=`<div class="section-head"><h2>Volatility-gap baseline · 15m paper filter</h2><span class="pill warn" id="gapBadge">RESEARCH ONLY</span></div>
 <p class="small muted">Zero-drift M0 averaged-settlement math plus a darup67-style 95% confidence and Kalshi fee filter. Uses only official observed BRTI and published market strike. This local 5-minute volatility estimate is NOT the upstream trained model; its probabilities are not validated.</p>
 <div class="grid astro-live-grid">
 <div class="metric"><h3>Paper gate result</h3><div class="big" id="gapAction">WAIT</div></div>
 <div class="metric"><h3>Modeled YES / NO</h3><div class="big" id="gapOdds">—</div></div>
 <div class="metric"><h3>Price gap / sigma cushion</h3><div class="big" id="gapCushion">—</div></div>
 <div class="metric"><h3>Est. settlement-only net EV / contract</h3><div class="big" id="gapEv">—</div></div>
 </div>
 <p class="small" id="gapReason">Waiting for five continuous minutes of official BRTI history.</p>
 <p class="small muted">No buy orders are sent and the primary BUY/WAIT signal is unaffected. Settlement EV assumes holding through expiry with the modeled probability and a general quadratic entry-fee estimate. It is not a seven-minute scalping P/L projection; spread, real fees and fills can erase an apparent edge. No published accuracy stats transfer to this adaptation.</p>
 <p class="small muted">Research: <a href="https://github.com/schen9999/btc-15m-engine" target="_blank" rel="noopener noreferrer">BTC 15m Engine</a> · <a href="https://github.com/darup67/kalshi-btc-agent" target="_blank" rel="noopener noreferrer">Kalshi BTC Agent</a>.</p>`;
 host.insertAdjacentElement('afterend',panel);
 const $=id=>panel.querySelector('#'+id);
 const cents=n=>Number.isFinite(n)?(n*100).toFixed(1)+'¢':'—';
 function update({snapshot,ticks,strike,closeAt,quote,now=Date.now(),fresh=false}={}){
  const model=gapProbability({snapshot:snapshot&&Array.isArray(ticks)?{...snapshot,history:ticks}:snapshot,
   strike,closeAt,now});
  const gate=fresh?gapConfidenceGate(model,quote):{...model,action:'WAIT',reason:'Waiting for a fresh, two-sided Kalshi order book; no paper call.'};
  $('gapBadge').textContent=!model.ready?'WARMING UP':gate.action==='WAIT'?'NO PAPER CALL':'PAPER CANDIDATE';
  $('gapAction').textContent=gate.action==='UP'?'PAPER YES':gate.action==='DOWN'?'PAPER NO':'WAIT';
  $('gapAction').className='big '+(gate.action==='UP'?'up':gate.action==='DOWN'?'down':'muted');
  $('gapOdds').textContent=model.ready?(100*model.pYes).toFixed(1)+'% / '+(100*model.pNo).toFixed(1)+'%':'—';
  $('gapCushion').textContent=model.ready?(model.gapUsd>=0?'+':'')+model.gapUsd.toFixed(2)+' USD · '+Math.abs(model.cushionSigma).toFixed(2)+'σ':'—';
  $('gapEv').textContent=cents(gate.netSettlementEv);
  $('gapReason').textContent=gate.reason||model.reason;
 }
 update();
 return {panel,update};
}
