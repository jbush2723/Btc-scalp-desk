import {API_BASE} from './config.js';
import {WINDOWS, finite, price, closeTime, selectMarket, normalizeBook, bookQuote, TradeFlow, fetchTradeWindow} from './flow.js';
import './manual.js';
import {SignalEngine} from './signal.js';

const $ = id => document.getElementById(id);
const put = (id, text) => { $(id).textContent = text; };
const number = n => n === null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US',{maximumFractionDigits:2});
const cents = n => n === null || !Number.isFinite(n) ? '—' : (n*100).toFixed(1)+'¢';
const flow = new TradeFlow();
const signals = new SignalEngine();
let current = null, book = null, quote = null, epoch = 0, busy = false, timer;
let marketAt = 0, bookAt = 0, flowAt = 0, through = 0, complete = false, failures = 0, lastError = '';
const controllers = new Set();
const storage = {get(k) {try{return localStorage.getItem(k)||'';}catch{return '';}}, set(k,v){try{localStorage.setItem(k,v);}catch{}}};
const local = ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
let base = storage.get('btcScalpApi') || API_BASE || (local ? location.origin+'/api' : 'https://external-api.kalshi.com/trade-api/v2');
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
  const healthy=marketFresh && bookFresh && flowFresh && complete && !lastError;
  const reading=signals.evaluate({now,ready:healthy&&!document.hidden&&now-through<6000,seconds,totals:WINDOWS.map(w=>flow.totals(w,now))});
  put('scalpAction',reading.action); $('scalpAction').className='signal-action '+(reading.action==='UP'?'up':reading.action==='DOWN'?'down':'warn');
  $('signalCard').dataset.direction=reading.action.toLowerCase();
  put('scalpReason',reading.reason);put('trendDirection',reading.trend);
  $('trendDirection').className='big '+(reading.trend==='UP'?'up':reading.trend==='DOWN'?'down':'muted');
  put('trendChange',reading.change===null?'Needs 30 seconds of live quotes':(reading.change>=0?'+':'')+reading.change.toFixed(1)+'¢ YES midpoint / ~30s');
  put('marketLean',reading.lean);
  put('signalFlow',reading.shares.length?'YES taker share · 10s '+share(reading.shares[0])+' / 30s '+share(reading.shares[1])+' / 60s '+share(reading.shares[2]):'Waiting for confirmed price history');
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
