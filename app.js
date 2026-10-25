import {API_BASE} from './config.js';
import {WINDOWS, finite, price, closeTime, selectMarket, normalizeBook, bookQuote, TradeFlow, fetchTradeWindow} from './flow.js';
import './manual.js';
import {SignalEngine} from './signal.js';
import {suggestPlan,planStatus} from './plan.js';
import {analyzeChart,drawChart} from './chart.js';
import {startBrti,getBrtiSnapshot} from './brti-ui.js';
import {evaluateBrtiContext,applyBrtiVeto} from './market-context.js';
import {startCryptometer} from './cryptometer-ui.js';
import {startSignalAudit} from './signal-audit.js';
import {settlementProjection,settlementEdge} from './settlement-forecast.js';
import {candlesFromTicks,drawBrtiCandles} from './brti-candles.js';
import {startRoundHistory} from './round-history.js';
import {startSettlementAudit} from './settlement-audit.js';
import {startPositionTracker} from './position-tracker.js';
import {installHistoricalReplay} from './historical-replay.js';
import {installKalshiHistory} from './kalshi-history.js';

const $ = id => document.getElementById(id);
const put = (id, text) => { $(id).textContent = text; };
const number = n => n === null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US',{maximumFractionDigits:2});
const cents = n => n === null || !Number.isFinite(n) ? '—' : (n*100).toFixed(1)+'¢';
const flow = new TradeFlow();
const signals = new SignalEngine();
let latestPlan=null, frozenPlan=null;
let current = null, book = null, quote = null, epoch = 0, busy = false, timer;
let marketAt = 0, bookAt = 0, flowAt = 0, through = 0, complete = false, failures = 0, lastError = '';
const controllers = new Set();
const storage = {get(k) {try{return localStorage.getItem(k)||'';}catch{return '';}}, set(k,v){try{localStorage.setItem(k,v);}catch{}}};
const local = ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
let base = storage.get('btcScalpApi') || API_BASE || (local ? location.origin+'/api' : 'https://external-api.kalshi.com/trade-api/v2');
const contextPanel=document.createElement('section');
contextPanel.className='card';
contextPanel.innerHTML='<h2>Official BRTI · signal cross-check</h2><p id="brtiContext" role="status">Waiting for verified BRTI data.</p><p class="small muted">Thirty-second BRTI move = 100 × (latest / earlier − 1). Distance = live BRTI − published Kalshi strike. If fresh BRTI moves at least 0.025% opposite a confirmed Kalshi scalp direction, the entry is blocked as conflicting. This threshold is experimental, not a tested trading edge. Missing BRTI does not create a directional signal. Four-hour free Cryptometer PUMP alerts remain context only, not evidence of net buying or selling.</p>';
document.querySelector('#signalCard').insertAdjacentElement('beforebegin',contextPanel);
const recordSignalAudit=startSignalAudit();
startCryptometer(()=>base);
startBrti(()=>base,()=>current&&closeTime(current)>Date.now()?{price:finite(current.floor_strike),ticker:current.ticker}:null);
const cockpit=document.createElement('div');
cockpit.id='tradeCockpit';
cockpit.setAttribute('aria-label','Live price chart and trading levels');
const brtiCard=$('brtiHeading').closest('section'),planCard=$('entryPlanCard');
const candleControls=document.createElement('div');
candleControls.id='candleControls';candleControls.className='candle-controls';
const candleViews=[['live','Live'],['15m','15m'],['30m','30m'],['1h','1h']];
const candleRanges={live:120000,'15m':900000,'30m':1800000,'1h':3600000};
let candleView='live';
try{const saved=sessionStorage.getItem('btcCandleView');if(candleRanges[saved])candleView=saved;}catch{}
for(const [key,label] of candleViews){
 const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.view=key;
 button.onclick=()=>{candleView=key;try{sessionStorage.setItem('btcCandleView',key);}catch{}render();};
 candleControls.append(button);
}
const candleLabel=document.createElement('span');
candleLabel.className='small muted';candleLabel.textContent='15s OHLC candles';
candleControls.append(candleLabel);
const candleChart=document.createElementNS('http://www.w3.org/2000/svg','svg');
candleChart.id='brtiCandleChart';
candleChart.setAttribute('role','img');
candleChart.setAttribute('aria-label','Official BRTI 15-second candlesticks');
const candleDetails=document.createElement('p');candleDetails.id='candleDetails';candleDetails.className='small muted';
const oldBrtiChart=$('brtiChart');
oldBrtiChart.hidden=true;
oldBrtiChart.insertAdjacentElement('beforebegin',candleControls);
oldBrtiChart.insertAdjacentElement('afterend',candleChart);
candleChart.insertAdjacentElement('afterend',candleDetails);

document.querySelector('header').insertAdjacentElement('afterend',cockpit);
cockpit.append(brtiCard,planCard);
const positionTracker=startPositionTracker();
let lastConfirmed=null;
const lastSignal=document.createElement('p');
lastSignal.id='lastConfirmedSetup';lastSignal.className='small muted';
lastSignal.textContent='No confirmed setup recorded in this round.';
planCard.querySelector('#planCall')?.insertAdjacentElement('afterend',lastSignal);

cockpit.insertAdjacentElement('afterend',positionTracker.section);
const forecastPanel=document.createElement('section');
forecastPanel.id='settlementForecast';
forecastPanel.className='card forecast-card';
forecastPanel.innerHTML=`<div class="section-head"><h2>Higher-risk · 15-minute settlement forecast</h2><span class="pill warn" id="forecastBadge">WARMING UP</span></div>
<div class="grid forecast-grid">
<div class="metric"><h3>Projected BRTI at close</h3><div class="big" id="forecastPrice">—</div></div>
<div class="metric"><h3>Illustrative 90% price range</h3><div class="big" id="forecastRange">—</div></div>
<div class="metric"><h3>Modeled finish above / below</h3><div class="big" id="forecastOdds">—</div></div>
<div class="metric"><h3>Riskier settlement lean</h3><div class="big" id="forecastLean">WAIT</div></div>
</div>
<p class="small" id="forecastMarket">Waiting for official price history.</p>
<p class="small muted" id="forecastExplanation">Experimental 90-second historical-volatility model; uncalibrated normal-return assumptions. Percentages are modeled estimates, not verified probabilities or a reliable trading edge. The settlement outcome uses the exchange's specified index and rules. Unlike scalp exits, holding to close can lose the entire stake; fees and execution matter.</p>`;
cockpit.insertAdjacentElement('afterend',forecastPanel);
const roundHistory=startRoundHistory();
forecastPanel.insertAdjacentElement('afterend',roundHistory.panel);
installHistoricalReplay(roundHistory.panel,()=>roundHistory.getHistory());
const kalshiHistory=installKalshiHistory(document.querySelector('#historicalReplay'),()=>base);
const settlementAudit=startSettlementAudit();
roundHistory.panel.insertAdjacentElement('afterend',settlementAudit.section);
const usdForecast=n=>Number.isFinite(n)?n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}):'—';

const quoteStrip=document.createElement('p');
quoteStrip.id='cockpitQuotes';quoteStrip.className='small mono';
quoteStrip.textContent='Waiting for YES/NO executable quotes';
planCard.querySelector('.section-head').insertAdjacentElement('afterend',quoteStrip);
const countdown=document.createElement('p');
countdown.id='cockpitCountdown';countdown.className='small muted';
countdown.textContent='Current contract: waiting';
quoteStrip.insertAdjacentElement('afterend',countdown);

$('feedUrl').value = storage.get('btcScalpApi');

function rows(id, values) {
  $(id).replaceChildren(...values.map(values => {
    const tr = document.createElement('tr');
    for (const value of values) { const td=document.createElement('td'); td.textContent=value; tr.append(td); }
    return tr;
  }));
}
function resetMarket(m) {
  epoch++; current=m; book=null; quote=null; marketAt=bookAt=flowAt=through=0; complete=false;
  flow.reset(m?.ticker || '');
  signals.reset();
  put('liveTicker',m?.ticker || 'No active contract');
  put('liveStrike','—'); put('lastPrice','—'); put('marketVolume','—'); put('openInterest','—');
  put('bookStatus','Waiting for order book'); put('flowStatus','Waiting for trade history');
  rows('bookRows',[]); rows('tapeRows',[['Waiting for trades','—','—','—','—']]);
  render();
}
async function get(path) {
  const controller = new AbortController(); controllers.add(controller);
  const timeout = setTimeout(()=>controller.abort(),8000);
  try {
    const r=await fetch(base+path,{signal:controller.signal,cache:'no-store',credentials:'omit'});
    if(!r.ok) {
      const err=Error('Kalshi data request returned HTTP '+r.status);
      const seconds=Number(r.headers.get('retry-after'));
      if(r.status===429) err.retryAfter=Number.isFinite(seconds)&&seconds>0 ? Math.min(seconds*1000,120000) : 30000;
      throw err;
    }
    return await r.json();
  } finally {clearTimeout(timeout); controllers.delete(controller);}
}
function updateMarket(m) {
  current=m; marketAt=Date.now();
  const strike=finite(m.floor_strike);
  put('liveStrike',strike===null?'Pending':strike.toLocaleString('en-US',{style:'currency',currency:'USD'}));
  put('lastPrice',cents(price(m.last_price_dollars)));
  put('marketVolume',number(finite(m.volume_fp))); put('openInterest',number(finite(m.open_interest_fp)));
  quote={yesBid:price(m.yes_bid_dollars),yesAsk:price(m.yes_ask_dollars),noBid:price(m.no_bid_dollars),noAsk:price(m.no_ask_dollars),
    yesBidSize:finite(m.yes_bid_size_fp),yesAskSize:finite(m.yes_ask_size_fp),noBidSize:null,noAskSize:null};
}
async function refresh() {
  if(busy || document.hidden) return;
  clearTimeout(timer); busy=true; $('refreshLive').disabled=true;
  let next=2000, requestEpoch=epoch;
  try {
    if(!current || closeTime(current)<=Date.now()) {
      const data=await get('/markets?series_ticker=KXBTC15M&status=open&limit=100');
      if(requestEpoch!==epoch) return;
      if(!Array.isArray(data.markets)) throw Error('Invalid market response');
      const m=selectMarket(data.markets);
      resetMarket(m); requestEpoch=epoch;
      if(!m) {lastError='No open BTC 15-minute contract. Retrying automatically.'; next=5000; return;}
      updateMarket(m);
    }
    const ticker=current.ticker, started=Date.now();
    const results=await Promise.allSettled([
      get('/markets/'+encodeURIComponent(ticker)),
      get('/markets/'+encodeURIComponent(ticker)+'/orderbook?depth=10'),
      fetchTradeWindow(get,ticker,started)
    ]);
    if(requestEpoch!==epoch || current?.ticker!==ticker) return;
    const errors=[];
    if(results[0].status==='fulfilled') {
      const m=results[0].value.market;
      if(m?.ticker!==ticker) errors.push(Error('Market response mismatch'));
      else if(closeTime(m)<=Date.now() || !['active','open'].includes(m.status)) {resetMarket(null);next=0;return;}
      else updateMarket(m);
    } else errors.push(results[0].reason);
    if(results[1].status==='fulfilled') {
      try {book=normalizeBook(results[1].value);bookAt=Date.now();signals.record(bookQuote(book),bookAt);} catch(e) {errors.push(e);}
    } else errors.push(results[1].reason);
    if(results[2].status==='fulfilled') {
      const batch=results[2].value;
      flow.add(batch.trades,Date.now()); flowAt=Date.now(); through=batch.through; complete=batch.complete;
    } else errors.push(results[2].reason);
    if(errors.length) throw errors[0];
    failures=0; lastError='';
  } catch(e) {
    if(requestEpoch===epoch) {
      failures++; lastError=e.name==='AbortError'?'Request timed out':e.message;
      next=Math.max(e.retryAfter||0,Math.min(30000,2000*2**Math.min(failures,4)))+Math.random()*500;
    }
  } finally {
    busy=false; $('refreshLive').disabled=false;render();
    if(!document.hidden) timer=setTimeout(refresh,requestEpoch!==epoch?0:next);
  }
}
function render() {
  const now=Date.now(), active=current && closeTime(current)>now;
  const marketFresh=active && now-marketAt<15000 && marketAt>0;
  const bookFresh=active && now-bookAt<15000 && bookAt>0;
  const flowFresh=active && now-flowAt<15000 && flowAt>0 && now-through<20000;
  const q=bookFresh ? bookQuote(book) : marketFresh ? quote : null;
  document.body.classList.toggle('stale',!q);
  for(const side of ['yes','no']) {
    for(const kind of ['Bid','Ask']) {put(side+kind,cents(q?.[side+kind]??null));put(side+kind+'Size',number(q?.[side+kind+'Size']??null)+' contracts');}
    const bid=q?.[side+'Bid'],ask=q?.[side+'Ask'];
    put(side+'Spread',bid==null||ask==null?'—':ask<bid?'Crossed / check feed':cents(ask-bid));
  }
  const seconds=active ? Math.max(0,Math.ceil((closeTime(current)-now)/1000)) : null;
  put('liveClock',seconds===null?'—':Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'));
  put('cockpitCountdown','Market '+(current?.ticker||'waiting')+' · closes in '+(seconds===null?'—':Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')));
  const quotesEl=$('cockpitQuotes');
  quotesEl.replaceChildren();
  for(const [side,content] of [
    ['yes','YES: bid '+cents(q?.yesBid??null)+' / ask '+cents(q?.yesAsk??null)],
    ['no','NO: bid '+cents(q?.noBid??null)+' / ask '+cents(q?.noAsk??null)]
  ]){
    const span=document.createElement('span');
    span.className='quote-side quote-side-'+side;
    span.textContent=content;
    quotesEl.append(span);
  }
  const healthy=marketFresh && bookFresh && flowFresh && complete && !lastError;
  const unfiltered=signals.evaluate({now,ready:healthy&&!document.hidden&&now-through<6000,seconds,totals:WINDOWS.map(w=>flow.totals(w,now))});
  const target=active?finite(current.floor_strike):null;
  const brtiContext=evaluateBrtiContext(getBrtiSnapshot(),target);
  const candleSnapshot=getBrtiSnapshot();
  const candleRange=candleRanges[candleView];
  const chartNow=Number.isFinite(candleSnapshot?.sourceTime)?candleSnapshot.sourceTime:now;
  const historicalTicks=roundHistory.observe({market:current,snapshot:candleSnapshot,now});
  const candleRows=candlesFromTicks(historicalTicks,{now:chartNow,windowMs:candleRange});
  drawBrtiCandles(candleChart,candleRows,{now:chartNow,windowMs:candleRange,strike:target});
  for(const button of candleControls.querySelectorAll('button')){
    const selected=button.dataset.view===candleView;
    button.setAttribute('aria-pressed',String(selected));
    button.classList.toggle('selected',selected);
  }
  const covered=candleRows.length?(candleRows.at(-1).time-candleRows[0].time)/60000:0;
  candleDetails.textContent=!candleSnapshot?
    'BRTI unavailable; previously recorded chart history remains visible where available.':
    candleRows.length+' observed 15-second candles · '+(covered>0?covered.toFixed(1):'0.0')+' minutes of available chart span. Missing candles are never filled; 30m and 1h views build as the backend collects history.';

  const reading=applyBrtiVeto(unfiltered,brtiContext);
  const forecast=settlementProjection({snapshot:getBrtiSnapshot(),strike:target,closeAt:active?closeTime(current):NaN,now});
  const odds=settlementEdge(forecast,q);
  settlementAudit.observe({market:current,forecast,ticks:historicalTicks,snapshot:candleSnapshot,now});
  put('forecastPrice',forecast.ready?usdForecast(forecast.center):'—');
  put('forecastRange',forecast.ready?usdForecast(forecast.low)+' – '+usdForecast(forecast.high):'—');
  put('forecastOdds',forecast.ready?(100*forecast.pAbove).toFixed(0)+'% / '+(100*forecast.pBelow).toFixed(0)+'%':'—');
  put('forecastLean',forecast.ready?(forecast.direction==='TOO CLOSE'?'WAIT':forecast.direction==='UP'?'UP · YES':'DOWN · NO'):'WAIT');
  put('forecastBadge',!forecast.ready?'WARMING UP':odds.worthConsidering?'SPECULATIVE':'MODEL ONLY');
  $('forecastBadge').className='pill '+(forecast.ready&&odds.worthConsidering?'warn':'');
  put('forecastMarket',!forecast.ready?forecast.reason:
    'BRTI now '+usdForecast(getBrtiSnapshot()?.price)+' · strike '+usdForecast(target)+
    ' · '+Math.ceil(forecast.secondsLeft/60)+' min to close'+
    (odds.side?' · '+odds.side+' ask '+cents(odds.ask)+
      ' · model minus ask '+(odds.edge*100>=0?'+':'')+(odds.edge*100).toFixed(1)+' percentage points. ':' · ')+odds.reason);

  const fmtPct=n=>n===null?'not enough history':(n>=0?'+':'')+n.toFixed(4)+'%';
  put('brtiContext',brtiContext.status==='live'?
    'Official BRTI '+brtiContext.direction+' · 30s '+fmtPct(brtiContext.changePercent)+' · target gap '+(brtiContext.distance===null?'unavailable':(brtiContext.distance>=0?'+':'')+brtiContext.distance.toFixed(2)+' USD')+
    (unfiltered.action!==reading.action?' · CONFLICT: ENTRY BLOCKED':' · no contrary-momentum veto'):
    'BRTI not fresh or unavailable; Kalshi-only rules remain active. No BRTI confirmation claimed.');
  put('scalpAction',reading.action); $('scalpAction').className='signal-action '+(reading.action==='UP'?'up':reading.action==='DOWN'?'down':'warn');
  put('signalConfidence',reading.confidence===null?'—':reading.confidence+' / 100');
  put('confidenceMeaning',reading.confidence===null?'Not enough fresh, usable evidence':reading.confidence>=80?'Strong rule agreement':reading.confidence>=60?'Moderate rule agreement':'Weak or conflicting evidence');
  $('signalCard').dataset.direction=reading.action.toLowerCase();
  put('scalpReason',reading.reason);put('trendDirection',reading.trend);
  $('trendDirection').className='big '+(reading.trend==='UP'?'up':reading.trend==='DOWN'?'down':'muted');
  put('trendChange',reading.change===null?'Needs 30 seconds of live quotes':(reading.change>=0?'+':'')+reading.change.toFixed(1)+'¢ YES midpoint / ~30s');
  put('marketLean',reading.lean);
  put('signalFlow',reading.shares.length?'YES taker share · 10s '+share(reading.shares[0])+' / 30s '+share(reading.shares[1])+' / 60s '+share(reading.shares[2]):'Waiting for confirmed price history');
  recordSignalAudit({ticker:current?.ticker,action:reading.action,score:reading.confidence,quote:bookFresh?bookQuote(book):null,now,quoteAt:bookAt,closeAt:active?closeTime(current):null,fresh:healthy&&now-bookAt<6000&&now-through<6000&&!document.hidden});
  const rawCosts=$('planCosts').value.trim();
  latestPlan=suggestPlan({reading,quote:q,samples:signals.samples,market:current,now,costCents:rawCosts===''?null:Number(rawCosts)});
  const plan=frozenPlan||latestPlan;
  if(latestPlan.available&&['UP','DOWN'].includes(reading.action)){
    lastConfirmed={ticker:current?.ticker,at:now,side:latestPlan.side,entry:latestPlan.entry};
  }
  if(lastConfirmed&&lastConfirmed.ticker!==current?.ticker)lastConfirmed=null;
  put('lastConfirmedSetup',lastConfirmed?
    'Last confirmed '+lastConfirmed.side.toUpperCase()+' setup at '+cents(lastConfirmed.entry)+
    ' · '+Math.floor((now-lastConfirmed.at)/1000)+'s ago'+
    (now-lastConfirmed.at>10000?' · EXPIRED — historical reference, NOT a new entry':' · confirm actual fill to track a position'):
    'No confirmed entry setup recorded in this round.');

  put('planCall',plan.available?(frozenPlan?'REFERENCE · '+plan.side.toUpperCase()+' entry '+cents(plan.entry):'SUGGESTED ENTRY · BUY '+plan.side.toUpperCase()+' at '+cents(plan.entry)+' or lower'):(reading.action==='WAIT'?'WAIT · Setup not ready':'SIT OUT · No entry suggested'));
  put('planSide',plan.available?(frozenPlan?'FROZEN · ':'BUY ')+plan.side.toUpperCase():'NO ENTRY');
  const planState=plan.available?(plan.side.toUpperCase()==='YES'?'yes':'no'):(reading.action==='WAIT'?'wait':'sitout');
  $('entryPlanCard').dataset.planState=planState;
  $('planCall').className='plan-call plan-state-'+planState;
  $('planSide').className='pill plan-state-'+planState;

  put('planEntry',plan.available?cents(plan.entry):'—');put('planTarget',plan.available?cents(plan.target):'—');put('planStop',plan.available?cents(plan.stop):'—');
  put('planHalf',plan.available&&plan.halfTarget!==null?cents(plan.halfTarget):'—');
  put('planReason',frozenPlan?planStatus(plan,{ticker:current?.ticker,quote:q,fresh:bookFresh&&now-bookAt<6000,seconds,action:reading.action}):plan.reason);
  put('planMath',plan.available?'Per contract · gross reward '+cents(plan.reward)+' / planned price risk '+cents(plan.risk)+' · '+plan.ratio.toFixed(2)+':1 gross'+(plan.netRatio===null?' · costs not included':'. With '+plan.costCents.toFixed(1)+'¢ costs: '+cents(plan.netReward)+' reward / '+cents(plan.netRisk)+' planned risk · '+plan.netRatio.toFixed(2)+':1 estimated net'):'Levels appear only when a confirmed signal has enough price room.');
  put('planMeta',plan.available?plan.ticker+' · '+(frozenPlan?'frozen':'calculated')+' '+new Date(plan.at).toLocaleTimeString()+' · ask size at calculation: '+number(plan.size)+' contracts':'');
  positionTracker.update({plan:latestPlan,ticker:current?.ticker,market:current,quote:q,fresh:bookFresh&&now-bookAt<6000,now});
  $('freezePlan').disabled=!frozenPlan&&!latestPlan.available;
  put('freezePlan',frozenPlan?'Release frozen plan':'Freeze this plan');
  const chart=analyzeChart(signals.samples,now);
  drawChart($('contractChart'),chart);
  put('chartReading',chart.direction);put('chartFast',cents(chart.fast));put('chartSlow',cents(chart.slow));
  put('chartRange',chart.low===null?'—':cents(chart.low)+' – '+cents(chart.high));
  const badge=document.hidden?'Paused':healthy?'Updating · REST':marketFresh||bookFresh?'Partial feed':lastError?'Feed unavailable':'Connecting';
  put('feedBadge',badge); $('feedBadge').className='pill '+(healthy?'up':'warn');
  const blocked=/fetch|403|401/i.test(lastError);
  put('liveStatus',lastError ? (blocked ? 'Feed unavailable. Direct browser access may be blocked; configure a hosted backend in Feed connection. ' : 'Feed interrupted. Retrying automatically. ')+lastError : current ? 'Kalshi public data · '+(base.includes('kalshi.com')?'direct connection':'read-only backend') : 'Looking for the next BTC contract…');
  const age=at=>at?Math.max(0,Math.floor((now-at)/1000))+'s ago':'waiting';
  put('freshness','Market '+age(marketAt)+' · book '+age(bookAt)+' · trades '+age(flowAt));
  put('bookStatus',bookFresh?'Snapshot '+age(bookAt)+' · quotes derived from this book':bookAt?'Book stale — levels hidden':'Waiting for order book');
  rows('bookRows',bookFresh?Array.from({length:Math.max(1,Math.min(8,Math.max(book.yes.length,book.no.length)))},(_,i)=>[cents(book.yes[i]?.[0]??null),number(book.yes[i]?.[1]??null),cents(book.no[i]?.[0]??null),number(book.no[i]?.[1]??null)]):[['—','—','—','—']]);
  put('flowStatus',flowFresh?(complete?'History fetched':'PARTIAL HISTORY · pagination limit reached')+' · through '+new Date(through).toLocaleTimeString()+' · latest '+Math.max(0,Math.ceil((now-through)/1000))+'s may be pending':flowAt?'Trade feed stale — totals hidden':'Waiting for trade history');
  rows('flowRows',WINDOWS.map(w=>{const t=flow.totals(w,now);return [w+'s',...['yes','no','unknown','net'].map(k=>flowFresh?(complete?'':'≥ ')+number(t[k]):'—')];}));
  // Net is not a lower bound when one side is missing.
  if(flowFresh&&!complete) for(const tr of $('flowRows').children) tr.lastChild.textContent='Partial';
  const tape=flowFresh?flow.recent(now):[];
  rows('tapeRows',tape.length?tape.map(t=>[new Date(t.at).toLocaleTimeString(),t.side.toUpperCase(),number(t.count),cents(t.yes),cents(t.no)]):[[flowFresh?'No trades in retained history':'Waiting for fresh trades','—','—','—','—']]);
}
function share(value){return value===null?'—':Math.round(value*100)+'%';}
$('planCosts').addEventListener('input',render);
$('freezePlan').onclick=()=>{frozenPlan=frozenPlan?null:latestPlan?.available?{...latestPlan}:null;render();};
$('refreshLive').onclick=()=>refresh();
$('feedForm').onsubmit=e=>{
  e.preventDefault();const raw=$('feedUrl').value.trim().replace(/\/+$/,'');
  try {
    if(raw){const u=new URL(raw);if(u.protocol!=='https:' || u.username || u.password || u.search || u.hash) throw Error('Use an HTTPS backend address without credentials, a query, or a fragment.');}
    storage.set('btcScalpApi',raw);base=raw || API_BASE || (local?location.origin+'/api':'https://external-api.kalshi.com/trade-api/v2');
    for(const c of controllers)c.abort();clearTimeout(timer);resetMarket(null);failures=0;lastError='';
    put('configStatus','Connection saved.');refresh();
  } catch(e) {put('configStatus',e.message);}
};
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(document.hidden){for(const c of controllers)c.abort();}else refresh();render();});
window.addEventListener('online',()=>refresh());
setInterval(()=>{if(current&&closeTime(current)<=Date.now()){resetMarket(null);refresh();}render();},500);
render();refresh();
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
