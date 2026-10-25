// Kalshi's public historical 1-minute YES bid/ask/trade OHLC. NOT the CF Benchmarks BRTI index.
// Import is incremental to respect request limits and preserves source and resolution.
const KEY='btcKalshiHistorical1mV1',MAX=800;
const price=v=>{const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=1?n:null;};
const quote=(obj,key)=>{
 if(!obj)return null;
 const n=price(obj[key+'_dollars']??obj[key]);
 return n;
};
const ts=m=>Date.parse(m?.close_time);
const round=(m,archived)=>({ticker:m.ticker,closeAt:ts(m),openAt:Date.parse(m.open_time),result:String(m.result||'').toLowerCase(),
 strike:Number(m.floor_strike)||null,archived});
function normalize(m,raw){
 const candles=(Array.isArray(raw?.candlesticks)?raw.candlesticks:[]).map(x=>({
  t:Number(x.end_period_ts)*1000,
  o:quote(x.price,'open'),h:quote(x.price,'high'),l:quote(x.price,'low'),c:quote(x.price,'close'),
  bo:quote(x.yes_bid,'open'),bh:quote(x.yes_bid,'high'),bl:quote(x.yes_bid,'low'),bc:quote(x.yes_bid,'close'),
  ao:quote(x.yes_ask,'open'),ah:quote(x.yes_ask,'high'),al:quote(x.yes_ask,'low'),ac:quote(x.yes_ask,'close')
 })).filter(c=>Number.isFinite(c.t)&&[c.bo,c.bc,c.ao,c.ac].some(v=>v!==null)).sort((a,b)=>a.t-b.t);
 return {...m,candles};
}
function load(){
 try{const data=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(data)?data.filter(x=>x?.ticker&&Array.isArray(x.candles)).slice(-MAX):[];}
 catch{return [];}
}
function draw(svg,rows,mode){
 svg.replaceChildren();svg.setAttribute('viewBox','0 0 850 265');
 const NS='http://www.w3.org/2000/svg';
 const el=(tag,attrs,text)=>{const x=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))x.setAttribute(k,v);if(text!==undefined)x.textContent=text;svg.append(x);};
 const fields=mode==='ask'?['ao','ah','al','ac']:mode==='bid'?['bo','bh','bl','bc']:['o','h','l','c'];
 const valid=rows.filter(x=>fields.every(k=>x[k]!==null));
 if(!valid.length){el('text',{x:'425',y:'135',fill:'#a9bad1','text-anchor':'middle'},'No observed OHLC values for this price type');return;}
 const low=Math.min(...valid.map(x=>x[fields[2]])),high=Math.max(...valid.map(x=>x[fields[1]]));
 const pad=Math.max(.015,(high-low)*.15),min=Math.max(0,low-pad),max=Math.min(1,high+pad);
 const y=v=>225-(v-min)/(max-min||.01)*200;
 const start=valid[0].t-60000,end=valid.at(-1).t;
 const x=t=>22+(t-start)/(end-start||60000)*720;
 for(let i=0;i<5;i++){const p=min+(max-min)*i/4,Y=y(p);el('line',{x1:22,x2:745,y1:Y,y2:Y,stroke:'#34435a','stroke-width':'.8'});el('text',{x:755,y:Y+4,fill:'#a9bad1','font-size':12},(100*p).toFixed(1)+'¢');}
 for(const candle of valid){
  const X=x(candle.t-30000),o=candle[fields[0]],h=candle[fields[1]],l=candle[fields[2]],c=candle[fields[3]],color=c>=o?'#62e8b7':'#ff959c';
  el('line',{x1:X,x2:X,y1:y(h),y2:y(l),stroke:color,'stroke-width':1.6});
  el('rect',{x:X-3,y:y(Math.max(o,c)),width:6,height:1.5,fill:color});
  // set the true body height even when the body is flat
  svg.lastChild.setAttribute('height',String(Math.max(1.5,Math.abs(y(o)-y(c)))));
 }
 for(let i=0;i<4;i++){const t=start+(end-start)*i/3;el('text',{x:x(t),y:255,fill:'#a9bad1','font-size':12,'text-anchor':i===0?'start':i===3?'end':'middle'},new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));}
}
export function installKalshiHistory(host,getBase){
 let items=load(),cursor={recent:null,archive:null},mode='recent',working=false,selected=null;
 const panel=document.createElement('section');panel.className='card kalshi-history';panel.id='kalshiHistory';
 panel.innerHTML=`<div class="section-head"><h2>Import historical Kalshi BTC15M markets · real contract charts</h2><span class="pill" id="historicCount">0 imported</span></div>
 <p class="small muted">Official Kalshi market history, recorded at <strong>1-minute</strong> candle resolution: YES trade, YES bid and YES ask. Not 15-second BRTI. Historical BRTI requires separate licensed index access. Import settled markets in manageable batches; chart old rounds individually. No prices or missing intervals are invented.</p>
 <div class="toolbar"><label for="historicSource">History source</label><select id="historicSource"><option value="recent">Recent settled markets</option><option value="archive">Older archived markets</option></select><button id="historicLoad" type="button">Import next 20 rounds</button><button class="secondary" id="historicResetCursor" type="button">Restart browsing source</button></div>
 <p id="historicStatus" role="status">Choose a source and import actual Kalshi candles.</p>
 <div class="round-history-body"><div class="round-history-list"><div id="historicList"></div></div><div class="round-history-detail"><h3 id="historicTitle">Choose an imported round</h3><div class="toolbar historic-types"><button type="button" data-type="trade">YES trade</button><button type="button" data-type="bid">YES bid</button><button type="button" data-type="ask">YES ask</button></div><svg id="historicChart" role="img" aria-label="Historical Kalshi contract candlesticks"></svg><p id="historicInfo" class="small muted">Official settlement result and 1-minute quote candles appear after import.</p></div></div>`;
 host.insertAdjacentElement('afterend',panel);
 const $=id=>panel.querySelector('#'+id);
 let chartType='trade';
 const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(items.slice(-MAX)));}catch{$('historicStatus').textContent+=' Browser storage full; new records may not persist.';}};
 const render=()=>{
  items.sort((a,b)=>a.closeAt-b.closeAt);
  $('historicCount').textContent=items.length+' imported';
  const latest=items.slice(-70).reverse(),container=$('historicList');container.replaceChildren();
  if(!latest.length)container.textContent='No imported Kalshi rounds yet.';
  if(latest.length&&!latest.some(m=>m.ticker===selected))selected=latest[0].ticker;
  for(const m of latest){
   const btn=document.createElement('button');btn.type='button';btn.className='round-select'+(selected===m.ticker?' selected':'');
   btn.textContent=new Date(m.closeAt).toLocaleString()+' · '+m.ticker+' · '+(m.result||'unsettled result');
   btn.onclick=()=>{selected=m.ticker;render();};container.append(btn);
  }
  const active=items.find(m=>m.ticker===selected);
  $('historicTitle').textContent=active?'Kalshi · '+active.ticker+' · '+active.result.toUpperCase():'Choose a historical contract';
  if(active){
   draw($('historicChart'),active.candles,chartType);
   $('historicInfo').textContent=active.candles.length+' observed 1-minute candles. Actual Kalshi result: '+active.result.toUpperCase()+
    '. YES bid/ask candles are quote observations, not guaranteed executable fills; this chart is NOT BRTI.';
  }
  for(const btn of panel.querySelectorAll('[data-type]'))btn.classList.toggle('selected',btn.dataset.type===chartType);
 };
 const fetchData=async url=>{
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{const r=await fetch(getBase()+url,{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error('Kalshi history HTTP '+r.status);return await r.json();}
  finally{clearTimeout(timeout);}
 };
 $('historicSource').onchange=()=>{mode=$('historicSource').value;$('historicStatus').textContent='Switched to '+(mode==='recent'?'recent':'archived')+' Kalshi markets.';};
 $('historicResetCursor').onclick=()=>{cursor[mode]=null;$('historicStatus').textContent='Pagination reset for this source. Already imported candles remain saved.';};
 for(const btn of panel.querySelectorAll('[data-type]'))btn.onclick=()=>{chartType=btn.dataset.type;render();};
 $('historicLoad').onclick=async()=>{
  if(working)return;working=true;$('historicLoad').disabled=true;let added=0,failed=0;
  try{
   let pages=0,found=[];
   while(found.length<20&&pages++<5){
    const route=mode==='recent'?'/markets?series_ticker=KXBTC15M&status=settled&limit=100':'/historical/markets?series_ticker=KXBTC15M&limit=100';
    const url=route+(cursor[mode]?'&cursor='+encodeURIComponent(cursor[mode]):'');
    const data=await fetchData(url);
    const markets=Array.isArray(data.markets)?data.markets:[];cursor[mode]=data.cursor||null;
    found.push(...markets.filter(m=>/^KXBTC15M-[A-Z0-9-]+$/.test(m.ticker)&&Number.isFinite(ts(m))&&String(m.result||'').toLowerCase()!==''));
    if(!cursor[mode]||!markets.length)break;
   }
   found=found.filter(m=>!items.some(x=>x.ticker===m.ticker)).slice(0,20);
   if(!found.length){$('historicStatus').textContent='No new completed rounds found on this page. Try the other history source or restart browsing.';return;}
   for(const m of found){
    try{
     const start=Math.floor(Date.parse(m.open_time)/1000),end=Math.ceil(Date.parse(m.close_time)/1000);
     if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>86400)continue;
     const prefix=mode==='archive'?'/historical/markets/':'/series/KXBTC15M/markets/';
     const raw=await fetchData(prefix+encodeURIComponent(m.ticker)+'/candlesticks?start_ts='+start+'&end_ts='+end+'&period_interval=1');
     const record=normalize(round(m,mode==='archive'),raw);
     if(!record.candles.length){failed++;continue;}
     items.push(record);items.sort((a,b)=>a.closeAt-b.closeAt);items=items.slice(-MAX);added++;
     $('historicStatus').textContent='Imported '+added+'/'+found.length+' rounds; '+failed+' missing candle responses…';
     if(added%5===0)save();
    }catch{failed++;}
   }
   save();selected=items.at(-1)?.ticker||selected;render();
   $('historicStatus').textContent='Imported '+added+' genuine historical contract charts ('+failed+' unavailable). Total saved '+items.length+'. Import again for another batch. The existing BRTI replay is separate.';
  }catch(e){$('historicStatus').textContent='History import stopped: '+e.message+'. Previous records remain saved.';}
  finally{working=false;$('historicLoad').disabled=false;render();}
 };
 render();
 return {panel,getHistory:()=>items.map(x=>({...x,candles:x.candles.map(c=>({...c}))}))};
}
