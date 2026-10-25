// Genuine historical Kalshi trade-flow import. Does not reconstruct order books or BRTI.
// Only completed, fully paginated rounds are scored. Missing data is NOT a negative signal.
const KEY='btcHistoricalFlowV1', LIMIT=100, MAX_TRADES=20000;
function load(){try{const v=JSON.parse(localStorage.getItem(KEY)||'{}');return v&&typeof v==='object'?v:{};}catch{return {};}}
function save(rows){try{localStorage.setItem(KEY,JSON.stringify(rows));return true;}catch{return false;}}
function normalize(t){
 const at=Date.parse(t.created_time),qty=Number(t.count_fp??t.count);
 const side=t.taker_outcome_side??t.taker_side;
 if(!Number.isFinite(at)||!Number.isFinite(qty)||qty<=0||!['yes','no'].includes(side)||t.is_block_trade===true)return null;
 return {at,qty,side,id:String(t.trade_id||'')};
}
export function flowAt(trades,at){
 const rows=trades.filter(t=>t.at<=at),window=seconds=>{
  const recent=rows.filter(t=>t.at>at-seconds*1000);
  const yes=recent.reduce((a,t)=>a+(t.side==='yes'?t.qty:0),0);
  const no=recent.reduce((a,t)=>a+(t.side==='no'?t.qty:0),0);
  return {yes,no,count:recent.length,share:yes+no>0?yes/(yes+no):null};
 };
 const w10=window(10),w30=window(30),w60=window(60);
 return {w10,w30,w60,up:w10.count>=5&&w10.yes+w10.no>=20&&w10.share>=.6&&w30.share>=.55&&w60.share>=.5,
 down:w10.count>=5&&w10.yes+w10.no>=20&&w10.share<=.4&&w30.share<=.45&&w60.share<=.5};
}
export function reviewTradeFlow(markets,records){
 let imported=0,complete=0,up=0,down=0,neutral=0,notEvaluable=0;
 const rows=[];
 for(const m of markets){
  const rec=records[m.ticker];if(!rec)continue;imported++;
  if(!rec.complete){notEvaluable++;continue;}complete++;
  const ticks=rec.trades||[];
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
  rows.push({ticker:m.ticker,closeAt:close,trades:ticks.length,upCount,downCount,checked,status});
 }
 return {imported,complete,notEvaluable,up,down,neutral,rows};
}
export function installHistoricalFlow(host,getMarkets,getBase){
 const panel=document.createElement('section');panel.className='card';panel.id='historicalFlow';
 panel.innerHTML='<div class="section-head"><h2>Historical trade pressure · real 10/30/60s flow</h2><span class="pill" id="historicalFlowCount">0 complete</span></div><p class="small muted">Imports Kalshi trades with the recorded aggressor outcome and contract quantity. The same flow thresholds used by the live model are checked at 10-second decision points. One-minute candles cannot reproduce the live 30-second quote momentum, 3 consecutive snapshots, executable order-book sizes or official BRTI veto, so this is a genuine flow-component audit, NOT a full-model accuracy or P/L backtest.</p><div class="toolbar"><button type="button" id="historicalFlowFetch">Import trades for next 5 saved rounds</button><button type="button" class="secondary" id="historicalFlowReview">Analyze imported trade flow</button></div><p id="historicalFlowStatus" role="status">Import historical contract charts above first, then use this trade-flow importer.</p><div class="table-scroll"><table><thead><tr><th>Round</th><th>Recorded trades</th><th>YES-pressure intervals</th><th>NO-pressure intervals</th><th>Evaluated 10s intervals</th></tr></thead><tbody id="historicalFlowRows"></tbody></table></div>';
 host.insertAdjacentElement('afterend',panel);
 const $=id=>panel.querySelector('#'+id);
 let records=load(),busy=false;
 const update=()=>{
  const result=reviewTradeFlow(getMarkets(),records);
  $('historicalFlowCount').textContent=result.complete+' complete';
  const tbody=$('historicalFlowRows');tbody.replaceChildren();
  for(const row of result.rows.slice(-30).reverse()){
   const tr=document.createElement('tr');
   for(const value of [new Date(row.closeAt).toLocaleString(),row.trades,row.upCount,row.downCount,row.checked]){
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
 $('historicalFlowFetch').onclick=async()=>{
  if(busy)return;busy=true;$('historicalFlowFetch').disabled=true;
  try{
   const markets=getMarkets().filter(m=>m?.ticker&&Number.isFinite(m.openAt)&&Number.isFinite(m.closeAt)&&m.closeAt<Date.now()).sort((a,b)=>b.closeAt-a.closeAt);
   const todo=markets.filter(m=>!records[m.ticker]?.complete).slice(0,5);
   if(!todo.length){$('historicalFlowStatus').textContent=markets.length?'No unimported rounds in the saved market set.':'No saved historical market rounds. Use Import next 20 rounds above first.';return;}
   for(const [index,m] of todo.entries()){
    let cursor=records[m.ticker]?.cursor||'',trades=records[m.ticker]?.trades||[],pages=0,done=false;
    const visited=new Set(),endpoint=m.archived?'/historical/trades':'/markets/trades';
    while(pages<12&&trades.length<MAX_TRADES){
     const args=new URLSearchParams({ticker:m.ticker,min_ts:String(Math.floor(m.openAt/1000)),max_ts:String(Math.ceil(m.closeAt/1000)),limit:'1000',is_block_trade:'false'});
     if(cursor)args.set('cursor',cursor);
     const response=await fetch(getBase()+endpoint+'?'+args,{cache:'no-store'});
     if(!response.ok){
      const retry=response.headers.get('Retry-After');
      throw Error('Kalshi HTTP '+response.status+(retry?' · retry after '+retry+'s':'')+' on '+m.ticker);
     }
     const data=await response.json();
     if(!Array.isArray(data.trades))throw Error('Invalid historical trade response');
     const seen=new Set(trades.map(t=>t.id));
     for(const t of data.trades){
      const row=normalize(t);
      if(row&&!seen.has(row.id)&&row.at>=m.openAt&&row.at<=m.closeAt){trades.push(row);seen.add(row.id);}
     }
     pages++;
     if(!data.cursor){cursor='';done=true;break;}
     if(visited.has(data.cursor))throw Error('Repeated pagination cursor');
     visited.add(data.cursor);cursor=data.cursor;
     await pause(350);
    }
    records[m.ticker]={ticker:m.ticker,complete:done,cursor,trades:trades.sort((a,b)=>a.at-b.at)};
    if(!save(records)){$('historicalFlowStatus').textContent='Browser storage is full. Existing imported trade records may not persist.';return;}
    $('historicalFlowStatus').textContent='Downloaded '+(index+1)+'/'+todo.length+' rounds · '+trades.length+' trades for latest round'+(done?'':' (partial; more pages needed)')+'.';
    update();
    await pause(600);
   }
   const stats=update();
   $('historicalFlowStatus').textContent='Historical trade import finished: '+stats.complete+' complete rounds and '+stats.notEvaluable+' incomplete. Select Analyze imported trade flow to inspect directional pressure.';
  }catch(e){$('historicalFlowStatus').textContent='Import stopped: '+e.message+'. Partial data remains stored; retry later if rate-limited.';}
  finally{busy=false;$('historicalFlowFetch').disabled=false;}
 };
 update();return panel;
}
