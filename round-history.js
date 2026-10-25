import {candlesFromTicks,drawBrtiCandles} from './brti-candles.js';
const KEY='btcScalpObservedRoundsV1',MAX_POINTS=10800,MAX_ROUNDS=32;
const money=v=>Number.isFinite(v)?v.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}):'—';
const fmtTime=t=>new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
function load(){
 try{
  const obj=JSON.parse(localStorage.getItem(KEY)||'{}');
  return {ticks:Array.isArray(obj.ticks)?obj.ticks.filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[1]>0).slice(-MAX_POINTS):[],
    rounds:Array.isArray(obj.rounds)?obj.rounds.filter(r=>r&&typeof r.ticker==='string'&&Number.isFinite(r.closeAt)).slice(-MAX_ROUNDS):[]};
 }catch{return {ticks:[],rounds:[]};}
}
function appendTicks(existing,incoming,now){
 const map=new Map(existing.map(x=>[x[0],x[1]]));
 for(const point of incoming||[]){
  if(!Number.isFinite(point?.time)||!Number.isFinite(point?.value)||point.value<=0||point.time>now+2000||point.time<now-86400000)continue;
  map.set(point.time,point.value);
 }
 return [...map].sort((a,b)=>a[0]-b[0]).slice(-MAX_POINTS);
}
function summary(round,ticks){
 const start=round.openAt??round.closeAt-900000;
 const samples=ticks.filter(p=>p[0]>=start&&p[0]<=round.closeAt);
 const candles=candlesFromTicks(samples.map(([time,value])=>({time,value})),{now:round.closeAt,windowMs:round.closeAt-start});
 const first=samples[0],last=samples.at(-1);
 const high=samples.length?Math.max(...samples.map(p=>p[1])):null;
 const low=samples.length?Math.min(...samples.map(p=>p[1])):null;
 const change=first&&last?100*(last[1]/first[1]-1):null;
 const coverage=candles.length/Math.ceil((round.closeAt-start)/15000);
 const closeObserved=last&&round.closeAt-last[0]<=5000;
 const direction=closeObserved&&Number.isFinite(round.strike)?(last[1]>round.strike?'ABOVE':last[1]<round.strike?'BELOW':'AT STRIKE'):'UNVERIFIED';
 return {samples,candles,first:first?.[1]??null,last:last?.[1]??null,high,low,change,coverage,direction,closeObserved};
}
export function startRoundHistory(){
 let state=load(),selected=null,lastSaved=0;
 const panel=document.createElement('section');
 panel.id='roundHistory';panel.className='card round-history';
 panel.innerHTML='<div class="section-head"><h2>Past BTC 15-minute rounds · charts & analysis</h2><span id="roundHistoryCount" class="pill">0 rounds</span></div><p class="small muted">Recorded official BRTI candles continue across contract boundaries. Historical rounds are saved in this browser as observations arrive. Price-derived outcomes are provisional, not verified Kalshi settlements. The browser cannot retrieve unrecorded older rounds.</p><div class="round-history-body"><div class="round-history-list"><div id="roundHistoryButtons"></div></div><div class="round-history-detail"><h3 id="roundHistoryTitle">Select a recorded round</h3><svg id="roundHistoryChart" role="img" aria-label="Historical 15-minute BRTI candlestick chart" viewBox="0 0 900 270"></svg><p id="roundHistoryStats" class="small">History collects as verified BRTI ticks arrive.</p></div></div>';
 const list=panel.querySelector('#roundHistoryButtons'),svg=panel.querySelector('#roundHistoryChart');
 const displayed=()=>state.rounds.filter(x=>x.closeAt<=Date.now()).slice(-12).reverse();
 function render(){
  const rounds=displayed();
  panel.querySelector('#roundHistoryCount').textContent=rounds.length+' saved rounds';
  if(!rounds.length){
   list.textContent='Past rounds appear after the current tracked market closes.';
   svg.replaceChildren();panel.querySelector('#roundHistoryTitle').textContent='Waiting for first recorded completed round';return;
  }
  if(!rounds.some(r=>r.ticker===selected))selected=rounds[0].ticker;
  list.replaceChildren();
  for(const round of rounds){
   const s=summary(round,state.ticks);
   const btn=document.createElement('button');btn.type='button';btn.className='round-select'+(selected===round.ticker?' selected':'');
   btn.textContent=fmtTime(round.closeAt)+' · '+round.ticker+' · '+(s.change===null?'—':(s.change>=0?'+':'')+s.change.toFixed(2)+'%');
   btn.onclick=()=>{selected=round.ticker;render();};
   list.append(btn);
  }
  const round=rounds.find(r=>r.ticker===selected),s=summary(round,state.ticks);
  panel.querySelector('#roundHistoryTitle').textContent='Round ending '+new Date(round.closeAt).toLocaleString()+' · strike '+money(round.strike);
  drawBrtiCandles(svg,s.candles,{now:round.closeAt,windowMs:Math.min(900000,round.closeAt-(round.openAt??round.closeAt-900000)),strike:round.strike});
  panel.querySelector('#roundHistoryStats').textContent=
   'First observed '+money(s.first)+' · last observed '+money(s.last)+' · high '+money(s.high)+' · low '+money(s.low)+
   ' · observed move '+(s.change===null?'—':(s.change>=0?'+':'')+s.change.toFixed(3)+'%')+
   ' · candle coverage '+(100*s.coverage).toFixed(0)+'% · closing comparison: '+s.direction+
   (s.closeObserved?' (unconfirmed BRTI observation)':' (no tick within 5 seconds of close)')+
   '. Gaps in data remain gaps; this is not a verified result or strategy backtest.';
 }
 let lastRendered=0,viewSignature='';
 function observe({market,snapshot,now=Date.now()}={}){
  if(snapshot?.status==='live'&&Array.isArray(snapshot.history))state.ticks=appendTicks(state.ticks,snapshot.history,now);
  if(market?.ticker&&Number.isFinite(Date.parse(market.close_time))){
   const closeAt=Date.parse(market.close_time);
   const openAt=Number.isFinite(Date.parse(market.open_time))?Date.parse(market.open_time):closeAt-900000;
   const strike=Number(market.floor_strike);
   const index=state.rounds.findIndex(r=>r.ticker===market.ticker);
   const record={ticker:market.ticker,closeAt,openAt,strike:Number.isFinite(strike)&&strike>0?strike:null};
   if(index>=0)state.rounds[index]=record;
   else state.rounds.push(record);
   state.rounds=state.rounds.sort((a,b)=>a.closeAt-b.closeAt).slice(-MAX_ROUNDS);
  }
  const signature=state.rounds.map(r=>r.ticker).join('|')+':'+Math.floor(now/15000);
  if(now-lastSaved>10000){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{}lastSaved=now;}
  if(signature!==viewSignature||now-lastRendered>5000){viewSignature=signature;lastRendered=now;render();}
  return state.ticks.map(([time,value])=>({time,value}));
 }
 render();
 return {panel,observe,getHistory:()=>({ticks:state.ticks.map(p=>[...p]),rounds:state.rounds.map(r=>({...r}))})};
}
