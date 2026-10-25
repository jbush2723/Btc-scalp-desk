// Automated paper-only open position monitor. Never places orders or infers fills.
// Distinct from the manual (user-confirmed) position tracker.
const KEY='btcScalpPaperPositionV1';
const HOLD_MS=420000,CLOSE_BUFFER=60000,QUOTE_GAP=15000,ENTRY_MAX_DELAY=8000,DEFAULT_STAKE=50;
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>0&&n<1;
const pct=(bid,entry)=>100*(bid/entry-1);
const money=n=>Number.isFinite(n)?'$'+n.toFixed(2):'—';
const cents=n=>Number.isFinite(n)?(100*n).toFixed(1)+'¢':'—';
const time=n=>Number.isFinite(n)?new Date(n).toLocaleTimeString():'—';
const left=ms=>{const sec=Math.max(0,Math.ceil(ms/1000));return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');};
// Experimental forward bid scenario, not a calibrated win probability.
// Uses only observed YES midpoints: 30s momentum damped with a 60s time constant.
// Unlike the planned target, this can project a loss, flat return or gain.
export function projectPaperReturn(position,{quote=null,samples=[],now=Date.now(),fresh=false}={}){
 if(!position||!fresh||!quote||!Array.isArray(samples)||samples.length<8||
   !['yes','no'].includes(position.side)||!valid(position.entry))return null;
 const bid=quote[position.side+'Bid'];
 if(!valid(bid))return null;
 const cutoff=Math.min(position.enteredAt+HOLD_MS,position.closeAt-CLOSE_BUFFER);
 const horizonSeconds=Math.min(420,Math.max(0,(cutoff-now)/1000));
 if(horizonSeconds<=0)return null;
 const data=samples.filter(p=>Number.isFinite(p.at)&&Number.isFinite(p.mid)&&
  p.at<=now&&p.at>=now-90000).sort((a,b)=>a.at-b.at);
 const latest=data.at(-1);
 if(data.length<8||!latest||now-latest.at>6000)return null;
 const baseline=data.filter(x=>x.at<=latest.at-30000).at(-1);
 if(!baseline||latest.at-baseline.at>36000||data.some((p,i)=>i&&p.at-data[i-1].at>8000))return null;
 const observedSeconds=(latest.at-baseline.at)/1000;
 const move30=(latest.mid-baseline.mid)*(position.side==='no'?-1:1)*30/observedSeconds;
 // Constant-velocity extrapolation would produce unrealistic multi-minute moves.
 // Apply an exponentially decaying 60-second momentum horizon instead.
 const projectedDelta=move30*2*(1-Math.exp(-horizonSeconds/60));
 const projectedBid=Math.max(.01,Math.min(.99,bid+projectedDelta));
 return {projectedBid,projectedPct:pct(projectedBid,position.entry),
  observedMoveCents:move30*100,horizonSeconds,
  planTargetPct:valid(position.target)?pct(position.target,position.entry):null,
  method:'Uncalibrated damped 30s contract-midpoint momentum; not a probability or expected return.'};
}
function load(){
 try{
  const v=JSON.parse(sessionStorage.getItem(KEY)||'null');
  if(!v||!Array.isArray(v.used)||!['object'].includes(typeof v))return {used:[],pending:null,active:null,last:null};
  return {used:v.used.filter(x=>typeof x==='string').slice(-80),pending:v.pending||null,active:v.active||null,last:v.last||null};
 }catch{return {used:[],pending:null,active:null,last:null};}
}
function save(value){try{sessionStorage.setItem(KEY,JSON.stringify(value));}catch{}}
export function advancePaperPosition(previous,{plan=null,reading=null,ticker=null,quote=null,bookAt=0,now=Date.now(),closeAt=null,fresh=false,stake=DEFAULT_STAKE}={}){
 const state={used:[...(previous?.used||[])],pending:previous?.pending?{...previous.pending}:null,
  active:previous?.active?{...previous.active}:null,last:previous?.last?{...previous.last}:null};
 const quoteFresh=Boolean(fresh&&quote&&Number.isFinite(bookAt)&&bookAt>0&&now-bookAt>=0&&now-bookAt<=6000);
 const snapTime=quoteFresh?bookAt:null;
 let message='Waiting for a fresh, confirmed model plan and the next available quote.';
 const finish=(reason,bid,at,verifiedBook)=>{
  const p=state.active;
  const gross=Number.isFinite(bid)?pct(bid,p.entry):null;
  state.last={...p,status:reason,exitAt:Number.isFinite(at)?at:now,exitBid:Number.isFinite(bid)?bid:null,
   grossPct:gross,grossPnl:Number.isFinite(gross)?p.qty*(bid-p.entry):null,
   simulated:true,liquidityObserved:verifiedBook===true};
  state.active=null;
  message=reason+'. '+(verifiedBook?'Observed bid and displayed bid size; fill NOT guaranteed.':
   'No observed executable exit quote; P/L is NOT known.');
 };
 const old=state.active;
 if(old){
  const cutoff=Math.min(old.enteredAt+HOLD_MS,old.closeAt-CLOSE_BUFFER);
  const badMarket=ticker&&ticker!==old.ticker;
  const bookIsCurrent=quoteFresh&&ticker===old.ticker&&snapTime>old.lastQuoteAt;
  if(bookIsCurrent&&snapTime<=cutoff){
   const bid=quote[old.side+'Bid'],size=quote[old.side+'BidSize'];
   if(valid(bid)&&bid<=1){
    old.lastBid=bid;old.lastQuoteAt=snapTime;old.lastBidSize=Number.isFinite(size)?size:0;
    const returnPct=pct(bid,old.entry);
    old.highestReturn=Math.max(old.highestReturn,returnPct);
    old.lowestReturn=Math.min(old.lowestReturn,returnPct);
    old.lastReading=reading?.action||'WAIT';
   }
  }
  if(now>=cutoff){
   if(Number.isFinite(old.lastQuoteAt)&&old.lastQuoteAt<=cutoff&&old.lastQuoteAt>=cutoff-QUOTE_GAP&&
    valid(old.lastBid)&&old.lastBidSize>=old.qty){
    finish(cutoff===old.closeAt-CLOSE_BUFFER?'EXIT · PRE-CLOSE LIMIT':'EXIT · 7-MINUTE LIMIT',old.lastBid,old.lastQuoteAt,true);
   }else if(now>cutoff+QUOTE_GAP||badMarket||now>=old.closeAt){
    finish('UNRESOLVED · EXIT QUOTE MISSING',null,null,false);
   }else{
    message='Exit deadline reached, but no recent bid with sufficient displayed size. Exit reference unavailable.';
   }
  }else if(badMarket){
   finish('UNRESOLVED · MARKET CHANGED',null,null,false);
  }else if(now-old.lastQuoteAt>QUOTE_GAP){
   message='DATA UNAVAILABLE · live bid is stale. Cannot mark a hypothetical exit.';
  }else if(bookIsCurrent&&valid(old.lastBid)){
   const gain=pct(old.lastBid,old.entry),sideSize=old.lastBidSize>=old.qty;
   if(sideSize&&old.lastBid<=old.stop){
    finish('STOP / EXIT',old.lastBid,old.lastQuoteAt,true);
   }else if(sideSize&&(old.lastBid>=old.target||gain>=15)){
    finish(gain>=40?'TAKE PROFIT · 40%+':old.lastBid>=old.target?'TAKE PROFIT · PLAN TARGET':'TAKE PROFIT · 15%+',old.lastBid,old.lastQuoteAt,true);
   }else if(sideSize&&((old.side==='yes'&&reading?.action==='DOWN')||(old.side==='no'&&reading?.action==='UP'))){
    finish('EXIT · OPPOSITE SIGNAL',old.lastBid,old.lastQuoteAt,true);
   }else if(!sideSize){
    message='Current bid depth is smaller than this paper position. No full-size exit assumed; monitor the book.';
   }else if(reading?.action===(old.side==='yes'?'UP':'DOWN')){
    message='HOLD / MONITOR · entry signal remains aligned. Stop, target and time limit are not triggered.';
   }else{
    message='HOLD WITH CAUTION · signal is no longer confirmed. Watch the selling bid and the exit deadline.';
   }
  }else if(quoteFresh){
   message='Waiting for a new order-book observation to update the paper exit mark.';
  }
  return {state,message};
 }
 if(state.pending){
  const p=state.pending;
  if(ticker!==p.ticker||now>=p.cutoff||now-p.signalAt>ENTRY_MAX_DELAY){
   state.last={...p,status:'NO PAPER FILL · ENTRY WINDOW EXPIRED',simulated:true};
   state.pending=null;
   message='The next executable ask was not observed before the paper entry window expired.';
  }else if(quoteFresh&&snapTime>p.signalBookAt){
   const ask=quote[p.side+'Ask'],bid=quote[p.side+'Bid'],size=quote[p.side+'AskSize'];
   const qty=valid(ask)&&Number.isFinite(size)&&size>0?
    Math.floor(Math.min(size,stake/ask)):0;
   if(valid(ask)&&valid(bid)&&bid<=ask&&ask-bid<=.03000001&&ask<=p.entryLimit+1e-8&&qty>=1){
    state.active={ticker:p.ticker,side:p.side,entry:ask,qty,enteredAt:snapTime,closeAt:p.closeAt,
     signalAt:p.signalAt,stop:p.stop,target:p.target,
     lastBid:bid,lastQuoteAt:snapTime,lastBidSize:Number(quote[p.side+'BidSize'])||0,
     highestReturn:pct(bid,ask),lowestReturn:pct(bid,ask)};
    state.pending=null;
    message='PAPER ENTRY OBSERVED · bought hypothetically at the next available ask. No actual order placed.';
   }else{
    state.last={...p,status:'NO PAPER FILL · ASK OR SIZE',simulated:true};
    state.pending=null;
    message='No assumed fill: next ask exceeded limit, spread was too wide, or displayed size was insufficient.';
   }
  }else{
   message='PAPER ENTRY PENDING · waiting for a new quote after the confirmed signal.';
  }
  return {state,message};
 }
 if(!plan?.available||!plan.ticker||plan.ticker!==ticker||!quoteFresh||
    !Number.isFinite(closeAt)||!Number.isFinite(now)||now>=closeAt-CLOSE_BUFFER||
    !['UP','DOWN'].includes(reading?.action)){
  return {state,message:state.last?.status||message};
 }
 const id=plan.ticker+':'+plan.side;
 if(state.used.includes(id))return {state,message:state.last?.status||'Signal already evaluated for this contract and side.'};
 if(!['yes','no'].includes(plan.side)||!valid(plan.entry)||!valid(plan.stop)||
   !valid(plan.target)||plan.stop>=plan.entry||plan.target<=plan.entry)
  return {state,message:'Entry plan failed paper-position validation.'};
 state.used.push(id);state.used=state.used.slice(-80);
 state.pending={ticker,side:plan.side,entryLimit:plan.entry,stop:plan.stop,target:plan.target,
  closeAt,signalAt:now,signalBookAt:bookAt,cutoff:Math.min(now+HOLD_MS,closeAt-CLOSE_BUFFER)};
 return {state,message:'PAPER ENTRY PENDING · confirmed signal; waiting for the NEXT fresh order-book snapshot.'};
}
export function startPaperPosition(){
 let state=load(),message='Waiting for a confirmed setup.',prediction=null;
 const section=document.createElement('section');
 section.className='card paper-position';
 section.id='paperPosition';
 section.innerHTML=`<div class="section-head"><h2>Hypothetical open position · live HOLD / EXIT</h2><span class="pill" id="paperBadge">NO PAPER POSITION</span></div>
 <p class="small muted">Automatically follows the actual confirmed live entry plan at the next qualifying ask. Monitors the same contract's selling bid until the earlier of +7 minutes or 1 minute before close. **Paper-only**: no order is placed, no fill or profit is guaranteed.</p>
 <div class="paper-layout">
  <div class="paper-decision">
   <div class="eyebrow" id="paperSide">AWAITING A CONFIRMED SETUP</div>
   <div class="paper-action warn" id="paperAction">WAIT</div>
   <p id="paperDecisionReason" class="small">Waiting for a confirmed buy plan.</p>
  </div>
  <div class="paper-metrics">
   <div class="metric"><h3>Hypothetical entry ask</h3><div class="big" id="paperEntry">—</div></div>
   <div class="metric"><h3>Current selling bid</h3><div class="big" id="paperBid">—</div></div>
   <div class="metric"><h3>Gross unrealized / exit return</h3><div class="big" id="paperReturn">—</div></div>
   <div class="metric"><h3>Time until exit deadline</h3><div class="big" id="paperDeadline">—</div></div>
  </div>
 </div>
 <div class="paper-projection-grid">
  <div class="metric"><h3>Experimental projected gross return</h3><div class="big" id="paperPredictedReturn">—</div></div>
  <div class="metric"><h3>Projected selling bid</h3><div class="big" id="paperPredictedBid">—</div></div>
  <div class="metric"><h3>Plan target gross upside</h3><div class="big" id="paperTargetPct">—</div></div>
 </div>
 <p class="small muted" id="paperPredictionNote">Needs at least 30 seconds of uninterrupted live contract quotes. This is an uncalibrated momentum scenario, not a reliable forecast.</p>
 <div class="paper-substats">
  <span id="paperQty">Paper size —</span><span id="paperGrossPnl">Gross P/L —</span>
  <span id="paperStop">Stop —</span><span id="paperTarget">Target —</span>
 </div>
 <p class="small muted mono" id="paperTicker">Not tracking a paper contract.</p>
 <p class="small muted">If price drops through the stop, reaches the plan target or +15% gross, or reverses on a confirmed opposite signal, the paper monitor calls EXIT. It never assumes a fill through missing quotes or insufficient displayed size. Return excludes fees and slippage. This is separate from any real trade you enter manually.</p>
 <div class="toolbar"><button class="secondary" type="button" id="paperReset">Reset paper position</button></div>`;
 const $=id=>section.querySelector('#'+id);
 function render(now=Date.now()){
  const p=state.active||state.pending||state.last;
  const active=state.active,closed=state.last&&!active&&!state.pending;
  const curr=active||closed?state.active||state.last:null;
  const gross=active&&valid(active.lastBid)?pct(active.lastBid,active.entry):closed?state.last.grossPct:null;
  const bid=active?active.lastBid:closed?state.last.exitBid:null;
  const remaining=active?Math.min(active.enteredAt+HOLD_MS,active.closeAt-CLOSE_BUFFER)-now:
   state.pending?state.pending.cutoff-now:null;
  const stateLabel=active?
   (message.startsWith('DATA UNAVAILABLE')?'DATA UNAVAILABLE':
    message.startsWith('Exit deadline')?'EXIT DUE · NO BID':
    message.startsWith('Current bid depth')?'EXIT DEPTH LOW':
    message.startsWith('HOLD WITH CAUTION')?'HOLD · CAUTION':'HOLD / MONITOR'):
   state.pending?'ENTRY PENDING':closed?(state.last.status||'PAPER CLOSED'):'WAIT';
  const color=active?(stateLabel==='HOLD / MONITOR'?'up':'warn'):
   state.pending?'warn':closed?(stateLabel.startsWith('TAKE PROFIT')?'up':stateLabel.startsWith('UNRESOLVED')?'warn':'down'):'warn';
  $('paperBadge').textContent=active?'PAPER OPEN':state.pending?'PAPER ENTRY PENDING':closed?'PAPER CLOSED':'NO PAPER POSITION';
  $('paperBadge').className='pill '+color;
  $('paperAction').textContent=stateLabel;
  $('paperAction').className='paper-action '+color;
  $('paperSide').textContent=p?.side?(p.side.toUpperCase()+' · hypothetical / no real position'):'AWAITING A CONFIRMED SETUP';
  $('paperDecisionReason').textContent=message;
  $('paperEntry').textContent=cents(curr?.entry??state.pending?.entryLimit);
  $('paperBid').textContent=cents(bid);
  $('paperReturn').textContent=Number.isFinite(gross)?(gross>=0?'+':'')+gross.toFixed(1)+'%':'—';
  $('paperReturn').className='big '+(Number.isFinite(gross)?gross>=0?'up':'down':'');
  $('paperDeadline').textContent=Number.isFinite(remaining)?left(remaining):closed?'COMPLETE':'—';
  const predicted=active?prediction:null;
  $('paperPredictedReturn').textContent=predicted?
   (predicted.projectedPct>=0?'+':'')+predicted.projectedPct.toFixed(1)+'%':'—';
  $('paperPredictedReturn').className='big '+(predicted?.projectedPct>=0?'up':predicted?'down':'');
  $('paperPredictedBid').textContent=cents(predicted?.projectedBid);
  const targetPct=Number.isFinite(curr?.entry)&&Number.isFinite(curr?.target)?
   pct(curr.target,curr.entry):null;
  $('paperTargetPct').textContent=Number.isFinite(targetPct)?'+'+targetPct.toFixed(1)+'%':'—';
  $('paperPredictionNote').textContent=predicted?
   'Experimental '+Math.round(predicted.horizonSeconds)+'s scenario using the latest uninterrupted ~30s YES midpoint trend, direction-adjusted for '+active.side.toUpperCase()+
   ', damped over 60s. Not calibrated, not a win probability, and not an executable price guarantee. The plan target is a separate take-profit level.':
   active?'Projection unavailable: need a fresh book and 30 seconds of uninterrupted price history. No missing data is invented.':
   'Projected percentages appear only while a hypothetical trade is open with fresh book and 30 seconds of uninterrupted quotes.';
  $('paperQty').textContent='Paper size '+(Number.isFinite(curr?.qty)?curr.qty+' contracts':'—');
  $('paperGrossPnl').textContent='Gross P/L '+money(Number.isFinite(gross)&&Number.isFinite(curr?.qty)?curr.qty*(bid-curr.entry):NaN);
  $('paperStop').textContent='Plan stop '+cents(curr?.stop);
  $('paperTarget').textContent='Plan target '+cents(curr?.target);
  $('paperTicker').textContent=p?.ticker?(p.ticker+' · entry '+time(curr?.enteredAt)+
   ' · latest observed '+time(curr?.lastQuoteAt)+
   (closed?' · closed '+time(state.last.exitAt):'')):'No hypothetical position opened.';
 }
 function update(info){
  const step=advancePaperPosition(state,info);
  const revised=JSON.stringify(step.state);
  if(revised!==JSON.stringify(state)){state=step.state;save(state);}
  message=step.message;
  const p=state.active;
  prediction=p?projectPaperReturn(p,{quote:info?.quote,samples:info?.samples||[],now:info?.now??Date.now(),fresh:info?.fresh}):null;
  render(info?.now??Date.now());
 }
 $('paperReset').onclick=()=>{
  state={used:[],pending:null,active:null,last:null};message='Tracker reset. Waiting for the next confirmed setup.';
  prediction=null;save(state);render();
 };
 render();
 return {section,update};
}
