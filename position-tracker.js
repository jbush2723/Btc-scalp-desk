// User-confirmed position helper, not connected to any brokerage account.
// Displays executable bid references only; never assumes an order filled.
const KEY='btcScalpManualPositionV1';
function load(){try{const r=JSON.parse(sessionStorage.getItem(KEY)||'null');return r&&typeof r.ticker==='string'&&['yes','no'].includes(r.side)&&Number.isFinite(r.entry)&&r.entry>0&&r.entry<1?r:null;}catch{return null;}}
function persist(v){try{if(v)sessionStorage.setItem(KEY,JSON.stringify(v));else sessionStorage.removeItem(KEY);}catch{}}
const fmt=n=>Number.isFinite(n)?(n*100).toFixed(1)+'¢':'—';
export function evaluatePosition(position,{ticker,quote,fresh,now=Date.now()}={}){
 if(!position)return {state:'NONE',note:'No position recorded.'};
 if(position.ticker!==ticker||now>=position.closeAt)return {state:'EXPIRED',note:'This contract is no longer active. Check your Kalshi account for the actual outcome and close the tracker.'};
 if(!fresh)return {state:'UNKNOWN',note:'Fresh bid unavailable. Do not assume a profitable or executable exit.'};
 const bid=quote?.[position.side+'Bid'];
 if(!Number.isFinite(bid)||bid<=0||bid>1)return {state:'UNKNOWN',note:'No valid selling bid. Do not assume an exit can be filled.'};
 const gain=100*(bid/position.entry-1),secondsLeft=Math.ceil((position.closeAt-now)/1000);
 if(secondsLeft<=60)return {state:'REVIEW EXIT',bid,gain,note:'Final minute: settlement exposure is high. Review your position and available liquidity.'};
 if(bid<=position.stop)return {state:'STOP / REVIEW',bid,gain,note:'Bid reached the recorded stop reference. Consider exiting; fills and losses can exceed the stop.'};
 if(gain>=40)return {state:'TAKE PROFIT',bid,gain,note:'Current bid meets the +40% gross target; review liquidity, fees and sale execution.'};
 if(gain>=15)return {state:'TAKE PROFIT / HOLD?',bid,gain,note:'Current bid meets your +15% gross objective. Consider taking profit; holding for +40% adds risk.'};
 if(now-position.enteredAt>=420000)return {state:'REVIEW EXIT',bid,gain,note:'Seven minutes elapsed since entry. Review the exit rather than extending the hold automatically.'};
 return {state:'HOLD / MONITOR',bid,gain,note:'Target and stop have not been reached at the current bid. Monitor actively; HOLD is not a guarantee.'};
}
export function startPositionTracker(){
 let position=load(),latest=null,quote=null;
 const section=document.createElement('section');section.className='card position-tracker';section.id='positionTracker';
 section.innerHTML='<div class="section-head"><h2>Manage your trade · manual position</h2><span class="pill" id="positionBadge">NO POSITION</span></div><p class="small muted">A new BUY signal is not an executed trade. Record your actual YES/NO fill to track HOLD, profit-taking and exit references. This tool does not place orders.</p><div id="positionSetup"><p id="positionProposal">Waiting for an eligible entry setup.</p><div class="toolbar"><label for="positionEntry">Your actual fill price (¢)</label><input id="positionEntry" type="number" min="1" max="99" step=".1" placeholder="Price in cents"><button type="button" id="positionConfirm">I bought this contract</button></div><p class="small muted">Only confirm after you actually bought the displayed contract. The suggested entry can differ from your fill.</p></div><div id="positionActive" hidden><p class="position-direction" id="positionAction">—</p><div class="grid plan-grid"><div class="metric"><h3>Actual entry</h3><div class="big" id="positionActualEntry">—</div></div><div class="metric"><h3>Current selling bid</h3><div class="big" id="positionBid">—</div></div><div class="metric"><h3>Gross return if sold at bid</h3><div class="big" id="positionGain">—</div></div><div class="metric"><h3>Gross profit targets</h3><div class="big" id="positionTargets">—</div></div></div><p id="positionNote">—</p><div class="toolbar"><button type="button" class="secondary" id="positionClear">I sold / stop tracking</button></div><p class="small muted">Targets are 15% and 40% over your actual entry. Gross return excludes Kalshi fees, slippage and order size. SELL bid is a reference, not a confirmed fill.</p></div>';
 const $=id=>section.querySelector('#'+id);
 $('positionConfirm').onclick=()=>{
  if(!latest?.available||!latest.ticker||!Number.isFinite(latest.closeAt)||latest.closeAt<=Date.now()||position)return;
  const entered=Number($('positionEntry').value)/100;
  if(!Number.isFinite(entered)||entered<=0||entered>=1){$('positionProposal').textContent='Enter your actual fill price in cents before confirming.';return;}
  position={ticker:latest.ticker,side:latest.side,entry:entered,stop:latest.stop,closeAt:latest.closeAt,enteredAt:Date.now()};
  persist(position);render();
 };
 $('positionClear').onclick=()=>{position=null;persist(null);render();};
 function render(){
  $('positionSetup').hidden=!!position;$('positionActive').hidden=!position;
  if(!position){
   $('positionBadge').textContent='NO POSITION';$('positionBadge').className='pill';
   $('positionConfirm').disabled=!latest?.available;
   $('positionProposal').textContent=latest?.available?
    'Eligible '+latest.side.toUpperCase()+' setup on '+latest.ticker+' · suggested entry '+fmt(latest.entry)+'. Record an actual fill to activate trade management.':
    'No fresh confirmed entry setup. Wait for one before recording a position.';
   if(latest?.available&&!$('positionEntry').value)$('positionEntry').value=(latest.entry*100).toFixed(1);
   return;
  }
  const result=evaluatePosition(position,quote||{});
  const stateColor=result.state==='TAKE PROFIT'||result.state==='TAKE PROFIT / HOLD?'?'up':
    result.state==='STOP / REVIEW'||result.state==='REVIEW EXIT'||result.state==='EXPIRED'?'down':
    result.state==='HOLD / MONITOR'?'warn':'';
  $('positionBadge').textContent=result.state;$('positionBadge').className='pill '+stateColor;
  $('positionAction').textContent='TRACKING '+position.side.toUpperCase()+' · '+position.ticker;
  $('positionActualEntry').textContent=fmt(position.entry);
  $('positionBid').textContent=fmt(result.bid);
  $('positionGain').textContent=Number.isFinite(result.gain)?(result.gain>=0?'+':'')+result.gain.toFixed(1)+'%':'—';
  $('positionGain').className='big '+(result.gain>=0?'up':'down');
  $('positionTargets').textContent=fmt(position.entry*1.15)+' / '+fmt(position.entry*1.4);
  $('positionNote').textContent=result.note;
 }
 function update({plan,ticker,market,quote:liveQuote,fresh,now=Date.now()}={}){
  latest=plan?.available&&!position?{...plan,closeAt:Date.parse(market?.close_time)}:null;
  quote={ticker,quote:liveQuote,fresh,now};
  render();
 }
 render();return {section,update};
}
