import {historyRecords,historyPut,historyMigrate,historyUsage} from './history-storage.js';
// Genuine historical Kalshi trade-flow import. Does not reconstruct order books or BRTI.
// Only completed, fully paginated rounds are scored. Missing data is NOT a negative signal.
const KEY='btcHistoricalFlowV1',MAX_TRADES=100000,COOLDOWN_KEY='btcHistoricTradeCooldownV1';
const MIN_REQUEST_GAP=3500,MAX_RATE_RETRIES=5;
let nextAllowedRequestAt=0;
function normalize(t){
 const at=Date.parse(t.created_time),qty=Number(t.count_fp??t.count);
 const side=t.taker_outcome_side??t.taker_side;
 if(!Number.isFinite(at)||!Number.isFinite(qty)||qty<=0||t.is_block_trade===true)return null;
 return {at,qty,side:['yes','no'].includes(side)?side:'unknown',id:String(t.trade_id||'')};
}
// Historical records are sorted once when imported. Binary search the 60s window
// to avoid rescanning every older trade at every 10-second checkpoint.
export function flowAt(trades,at){
 let lo=0,hi=trades.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(trades[mid].at<=at-60000)lo=mid+1;else hi=mid;}
 const window=seconds=>({yes:0,no:0,unknown:0,count:0,share:null});
 const w10=window(),w30=window(),w60=window();
 for(let i=lo;i<trades.length&&trades[i].at<=at;i++){
  const t=trades[i];
  for(const [seconds,acc] of [[10,w10],[30,w30],[60,w60]]){
   if(t.at<=at-seconds*1000)continue;
   acc[t.side==='yes'?'yes':t.side==='no'?'no':'unknown']+=t.qty;
   acc.count++;
  }
 }
 for(const w of [w10,w30,w60]){
  if(w.yes+w.no>0)w.share=w.yes/(w.yes+w.no);
 }
 const reliable=[w10,w30,w60].every(w=>w.unknown/(w.yes+w.no+w.unknown||1)<=.1);
 return {w10,w30,w60,up:reliable&&w10.count>=5&&w10.yes+w10.no>=20&&w10.share>=.6&&w30.share>=.55&&w60.share>=.5,
 down:reliable&&w10.count>=5&&w10.yes+w10.no>=20&&w10.share<=.4&&w30.share<=.45&&w60.share<=.5};
}

export function reviewTradeFlow(markets,records){
 let imported=0,complete=0,up=0,down=0,neutral=0,notEvaluable=0;
 const rows=[];
 for(const m of markets){
  const rec=records[m.ticker];if(!rec)continue;imported++;
  if(!rec.complete){
   notEvaluable++;
   rows.push({ticker:m.ticker,closeAt:m.closeAt,trades:rec.trades?.length||0,
    upCount:'—',downCount:'—',checked:'—',status:'Partial · resume next page',complete:false});
   continue;
  }
  complete++;
  const ticks=(rec.trades||[]).slice().sort((a,b)=>a.at-b.at);
  const open=Number(m.openAt),close=Number(m.closeAt);
  if(!ticks.length||!Number.isFinite(open)||!Number.isFinite(close)){neutral++;continue;}
  // Evaluate once at each full 10s time boundary; historical event timestamps are exact.
  let upCount=0,downCount=0,checked=0;
  for(let at=Math.ceil((open+60000)/10000)*10000;at<=close-60000;at+=10000){
   const f=flowAt(ticks,at);checked++;
   if(f.up)upCount++;if(f.down)downCount++;
  }
  const status=upCount?'YES pressure':downCount?'NO pressure':'No qualifying 10/30/60s pressure';
  if(upCount)up++;else if(downCount)down++;else neutral++;
  rows.push({ticker:m.ticker,closeAt:close,trades:ticks.length,upCount,downCount,checked,status,complete:true});
 }
 return {imported,complete,notEvaluable,up,down,neutral,rows};
}
export function installHistoricalFlow(host,getMarkets,getBase){
 const panel=document.createElement('section');panel.className='card';panel.id='historicalFlow';
 panel.innerHTML='<div class="section-head"><h2>Historical trade pressure · real 10/30/60s flow</h2><span class="pill" id="historicalFlowCount">0 complete</span></div><p class="small muted">Imports Kalshi trades with the recorded aggressor outcome and contract quantity. The same flow thresholds used by the live model are checked at 10-second decision points. One-minute candles cannot reproduce the live 30-second quote momentum, 3 consecutive snapshots, executable order-book sizes or official BRTI veto, so this is a genuine flow-component audit, NOT a full-model accuracy or P/L backtest.</p><div class="toolbar"><button type="button" id="historicalFlowFetch">Import trades for next 5 saved rounds</button><button type="button" class="secondary" id="historicalFlowReview">Analyze imported trade flow</button></div><p id="historicalFlowStatus" role="status">Import historical contract charts above first, then use this trade-flow importer.</p><p class="small muted" id="flowStorageStats">Initializing historical database…</p><div class="table-scroll"><table><thead><tr><th>Round</th><th>Status</th><th>Recorded trades</th><th>YES-pressure intervals</th><th>NO-pressure intervals</th><th>Evaluated 10s intervals</th></tr></thead><tbody id="historicalFlowRows"></tbody></table></div>';
 host.insertAdjacentElement('afterend',panel);
 const $=id=>panel.querySelector('#'+id);
 let records={},busy=false,ready=false,cancelRequested=false;
 const cancelButton=document.createElement('button');
 cancelButton.type='button';cancelButton.id='historicalFlowCancel';cancelButton.className='secondary';cancelButton.textContent='Pause import';cancelButton.disabled=true;
 $('historicalFlowFetch').insertAdjacentElement('afterend',cancelButton);
 cancelButton.onclick=()=>{cancelRequested=true;$('historicalFlowStatus').textContent='Pausing safely after the current request. Downloaded pages remain saved.';};
 $('historicalFlowFetch').disabled=true;
 $('historicalFlowReview').disabled=true;
 const storageStatus=async()=>{
  const estimate=await historyUsage();
  $('flowStorageStats').textContent=estimate?
   'Historical data uses browser database storage (IndexedDB). Origin storage: '+(estimate.usage/1048576).toFixed(1)+' MB of '+(estimate.quota/1048576).toFixed(1)+' MB quota currently used.':
   'Historical data uses browser database storage (IndexedDB). Usage estimate unavailable.';
 };
 const update=()=>{
  const result=reviewTradeFlow(getMarkets(),records);
  $('historicalFlowCount').textContent=result.complete+' complete';
  const tbody=$('historicalFlowRows');tbody.replaceChildren();
  for(const row of result.rows.slice(-30).reverse()){
   const tr=document.createElement('tr');
   for(const value of [new Date(row.closeAt).toLocaleString(),row.status,row.trades,row.upCount,row.downCount,row.checked]){
    const td=document.createElement('td');td.textContent=String(value);tr.append(td);
   }tbody.append(tr);
  }
  return result;
 };
 $('historicalFlowReview').onclick=()=>{
  const r=update();
  $('historicalFlowStatus').textContent=r.complete+' complete rounds · '+r.up+' with YES pressure · '+r.down+' with NO pressure · '+r.neutral+' with no qualifying pressure · '+r.notEvaluable+' incomplete. This tests only recorded trade-flow gates, not trading profitability.';
 };
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const retryAfterMs=header=>{
  if(!header)return 30000;
  const seconds=Number(header);
  if(Number.isFinite(seconds))return Math.min(120000,Math.max(1000,Math.ceil(seconds*1000)));
  const timestamp=Date.parse(header);
  return Number.isFinite(timestamp)?Math.min(120000,Math.max(1000,timestamp-Date.now())):30000;
 };
 const readCooldown=()=>{try{return Number(sessionStorage.getItem(COOLDOWN_KEY))||0;}catch{return 0;}};
 const setCooldown=until=>{try{sessionStorage.setItem(COOLDOWN_KEY,String(until));}catch{}};
 async function waitForSlot(label){
  while(!cancelRequested){
   const deadline=Math.max(nextAllowedRequestAt,readCooldown());
   const remaining=deadline-Date.now();
   if(remaining<=0)return;
   $('historicalFlowStatus').textContent=label+' · Kalshi cooldown: '+Math.ceil(remaining/1000)+'s. Saved pages remain available.';
   await pause(Math.min(1000,remaining));
  }
  throw Error('Paused at your request; saved pages are ready to resume.');
 }
 async function getHistoricalTrades(endpoint,args,ticker){
  let retries=0;
  while(!cancelRequested){
   await waitForSlot('Downloading '+ticker);
   // Limit import traffic; the normal live-price polling is not part of this queue.
   nextAllowedRequestAt=Date.now()+MIN_REQUEST_GAP;
   let response;
   try{response=await fetch(getBase()+endpoint+'?'+args,{cache:'no-store'});}
   catch(e){throw Error('Historical download network error: '+e.message);}
   if(response.status===429){
    retries++;
    const retryMs=Math.max(retryAfterMs(response.headers.get('Retry-After')),Math.min(120000,30000*2**(retries-1)));
    setCooldown(Date.now()+retryMs+2000);
    if(retries>MAX_RATE_RETRIES)throw Error('Kalshi is still rate-limiting after '+MAX_RATE_RETRIES+' retries; saved progress can be resumed later.');
    $('historicalFlowStatus').textContent='Kalshi HTTP 429 for '+ticker+' · pausing '+Math.ceil((retryMs+2000)/1000)+'s automatically (retry '+retries+'/'+MAX_RATE_RETRIES+').';
    continue;
   }
   if(!response.ok)throw Error('Kalshi HTTP '+response.status+' on '+ticker);
   const data=await response.json();
   if(!Array.isArray(data.trades))throw Error('Invalid historical trade response');
   return data;
  }
  throw Error('Paused at your request; saved pages are ready to resume.');
 }
 $('historicalFlowFetch').onclick=async()=>{
  if(busy||!ready)return;busy=true;cancelRequested=false;$('historicalFlowFetch').disabled=true;cancelButton.disabled=false;
  try{
   const markets=getMarkets().filter(m=>m?.ticker&&Number.isFinite(m.openAt)&&Number.isFinite(m.closeAt)&&m.closeAt<Date.now()).sort((a,b)=>b.closeAt-a.closeAt);
   const todo=markets.filter(m=>!records[m.ticker]?.complete).slice(0,5);
   if(!todo.length){$('historicalFlowStatus').textContent=markets.length?'No unimported rounds in the saved market set.':'No saved historical market rounds. Use Import next 20 rounds above first.';return;}
   for(const [index,m] of todo.entries()){
    let cursor=records[m.ticker]?.cursor||'',trades=records[m.ticker]?.trades||[],pages=0,done=false;
    if(trades.length>=MAX_TRADES)throw Error('Historical trade safety cap reached for '+m.ticker+' ('+MAX_TRADES+' trades). Partial data remains saved but cannot be scored as a complete round.');
    const visited=new Set(),endpoint=m.archived?'/historical/trades':'/markets/trades';
    while(pages<12&&trades.length<MAX_TRADES){
     if(cancelRequested)throw Error('Paused at your request; downloaded pages are saved.');
     const args=new URLSearchParams({ticker:m.ticker,min_ts:String(Math.floor(m.openAt/1000)),max_ts:String(Math.ceil(m.closeAt/1000)),limit:'1000',is_block_trade:'false'});
     if(cursor)args.set('cursor',cursor);
     const data=await getHistoricalTrades(endpoint,args,m.ticker);
     const seen=new Set(trades.map(t=>t.id));
     for(const t of data.trades){
      const row=normalize(t);
      if(row&&!seen.has(row.id)&&row.at>=m.openAt&&row.at<=m.closeAt){trades.push(row);seen.add(row.id);}
     }
     pages++;
     if(!data.cursor){cursor='';done=true;}
     else{
      if(visited.has(data.cursor))throw Error('Repeated pagination cursor');
      visited.add(data.cursor);cursor=data.cursor;
     }
     // Save every retrieved page. If Kalshi rate-limits the next request,
     // a retry resumes from this cursor instead of redownloading trades.
     const checkpoint={ticker:m.ticker,complete:done,cursor,trades:trades.slice().sort((a,b)=>a.at-b.at)};
     await historyPut('tradeFlows',checkpoint);
     records[m.ticker]=checkpoint;
     $('historicalFlowStatus').textContent='Saved '+trades.length+' trades for '+m.ticker+' · page '+pages+'/12 this batch · '+(done?'round complete':'more trade pages remain')+'.';
     if(done)break;
    }
    const record={ticker:m.ticker,complete:done,cursor,trades:trades.sort((a,b)=>a.at-b.at)};
    // Commit only this ticker, not a giant serialized object for every imported round.
    try{await historyPut('tradeFlows',record);}
    catch(e){throw Error('Could not save '+m.ticker+' to browser database: '+e.message+'; existing data was preserved.');}
    records[m.ticker]=record;
    $('historicalFlowStatus').textContent='Processed '+(index+1)+'/'+todo.length+' rounds · '+trades.length+' trades for '+m.ticker+(done?' (complete).':' (partial · '+pages+' pages this batch; click again to resume).');
    update();
    await storageStatus();
    if(cancelRequested)throw Error('Paused at your request; downloaded pages are saved.');
   }
   const stats=update();
   $('historicalFlowStatus').textContent='Historical trade import finished: '+stats.complete+' complete rounds and '+stats.notEvaluable+' incomplete. '+(stats.notEvaluable?'Click Import again to continue saved trade pages. ':'')+'Select Analyze imported trade flow for completed rounds.';
  }catch(e){$('historicalFlowStatus').textContent='Import paused: '+e.message+' Partial data is saved and will resume from the last page on the next import.';}
  finally{busy=false;$('historicalFlowFetch').disabled=!ready;cancelButton.disabled=true;}
 };
 async function initialize(){
  try{
   const migration=await historyMigrate('tradeFlows',KEY,'object');
   const saved=await historyRecords('tradeFlows');
   records=Object.fromEntries(saved.map(x=>[x.ticker,x]));
   ready=true;
   $('historicalFlowFetch').disabled=false;
   $('historicalFlowReview').disabled=false;
   update();
   await storageStatus();
   $('historicalFlowStatus').textContent=
    'Ready: '+saved.length+' saved round trade records in browser database.'+
    (migration.migrated?' Migrated '+migration.migrated+' previous records safely.':'')+
    ' Import another batch whenever you want.';
  }catch(e){
   $('historicalFlowStatus').textContent='Historical storage unavailable: '+e.message+'. Previous imports were not deleted. Check browser storage permissions.';
   $('flowStorageStats').textContent='IndexedDB could not initialize; imports are paused to avoid data loss.';
  }
 }
 initialize();return panel;
}
