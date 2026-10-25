// Private recorder health + as-observed shared-engine paper replay.
// This is intentionally not blended into older candle-only simulations.
export function installFullReplay(host,getBase){
 const panel=document.createElement('section');panel.id='fullModelReplay';panel.className='card';
 panel.innerHTML=`<div class="section-head"><h2>Live-data recorder & actual-model paper replay</h2><span class="pill warn" id="modelRecorderBadge">CHECKING</span></div>
 <p class="small muted">The server records Kalshi order-book snapshots, trades with first-observed times, and authorized BRTI ticks while it is awake. Replay calls the same SignalEngine, BRTI veto and entry-plan code as the live desk. It does not backfill missing order-book snapshots or claim real fills.</p>
 <p class="small" id="modelRecorderStatus" role="status">Checking recorder connection and private authentication…</p>
 <form id="modelRecorderConnect" autocomplete="off"><label for="modelRecorderToken">Private BRTI viewing token (Render BRTI_VIEW_TOKEN)</label><div class="toolbar"><input type="password" id="modelRecorderToken" autocomplete="off" placeholder="Enter viewing token for this tab"><button type="submit">Connect recorder</button></div><p class="small muted">The recorder uses the same viewing token as Live CF BRTI. It is saved only in sessionStorage for this browser tab. Never enter your Kalshi private/API key here.</p></form>
 <p class="small muted" id="modelRecorderStorage">Recording storage not checked yet.</p>
 <div class="toolbar"><button type="button" class="secondary" id="modelRecorderRefresh">Refresh recorder status</button><button type="button" class="secondary" id="modelRecorderExport">Export recorded rounds (JSON)</button></div>
 <div class="scenario-card"><h3>Actual-model replay · $1,000 example</h3>
 <div class="toolbar">
 <label>Starting bankroll ($)<input id="modelReplayBankroll" type="number" min="1" max="1000000" value="1000"></label>
 <label>Stake per trade ($)<input id="modelReplayStake" type="number" min="1" max="100000" value="50"></label>
 <label>Estimated fee per side (¢/contract)<input id="modelReplayFee" type="number" min="0" max="20" step=".1" value="1"></label>
 <label>Recent rounds<input id="modelReplayRounds" type="number" min="1" max="60" value="30"></label>
 <button type="button" id="modelReplayRun">Run shared-engine replay</button></div>
 <p id="modelReplayResults" role="status">Run after the server has recorded fresh live rounds. Previous one-minute imports cannot replace missing live order books.</p>
 <svg id="modelReplayEquity" role="img" aria-label="Hypothetical bankroll equity curve" viewBox="0 0 780 180" style="width:100%;max-height:180px"></svg>
 <p id="modelReplayCoverage" class="small muted">No replay coverage measured yet.</p>
 <p class="small muted">Hypothetical fills at the next recorded ask and later recorded bid require shown size. Gaps are never filled. Exits without demonstrated liquidity are unresolved, not profitable trades. No order placement or verified fills. This is not proof of a trading edge.</p>
 <div class="table-scroll"><table><thead><tr><th>Round</th><th>Side</th><th>Entry</th><th>Exit</th><th>Qty</th><th>Est. fees</th><th>Net P/L</th><th>Exit reason</th></tr></thead><tbody id="modelReplayTrades"></tbody></table></div>
 </div>`;
 host.insertAdjacentElement('afterend',panel);
 const $=id=>panel.querySelector('#'+id);
 const token=()=>{try{return sessionStorage.getItem('btcBrtiViewToken')||'';}catch{return '';}};
 const base=()=>String(getBase()||'').replace(/\/+$/,'');
 let statusBusy=false;
 const statusError=(code,message)=>{
  const error=Error(message);error.statusCode=code;return error;
 };
 const badgeForError=e=>e.statusCode||'UNAVAILABLE';
 const money=n=>Number(n).toLocaleString('en-US',{style:'currency',currency:'USD'});
 const date=x=>x?new Date(x).toLocaleString():'—';
 const text=(id,value)=>{$(id).textContent=value;};
 const get=async(path,{binary=false}={})=>{
  const backend=base();
  if(!backend)throw statusError('SET BACKEND','Feed connection is empty. Set it to https://btc-scalp-desk-98s3.onrender.com/api, then refresh this page.');
  let origin;
  try{origin=new URL(backend,location.href);}
  catch{throw statusError('SET BACKEND','Feed connection URL is not valid. Use your Render service URL ending in /api.');}
  if(!['http:','https:'].includes(origin.protocol)||origin.hostname.endsWith('kalshi.com')||!origin.pathname.endsWith('/api'))
   throw statusError('SET BACKEND','The recorder needs your own Render backend URL ending in /api, not Kalshi directly. Current backend: '+origin.origin+origin.pathname);
  const t=token();
  if(!t)throw statusError('TOKEN NEEDED','Enter the private BRTI_VIEW_TOKEN using Connect recorder above. The token is browser-tab-specific and is not the Kalshi API key.');
  let response;
  try{
   response=await fetch(backend+path,{
    headers:{'X-BRTI-Token':t},credentials:'omit',cache:'no-store',
    signal:AbortSignal.timeout(75000)
   });
  }catch(e){
   if(e.name==='TimeoutError'||e.name==='AbortError')
    throw statusError('SERVER TIMEOUT','Render did not respond within 75 seconds. Free instances can take time to wake; check the service status and try Refresh recorder status.');
   throw statusError('NETWORK ERROR','Could not reach '+origin.origin+'. Verify the Render service is running and the Feed connection URL is correct. Network/CORS detail: '+e.message);
  }
  if(response.status===403||response.status===401)
   throw statusError('TOKEN REJECTED','The backend rejected the viewing token (HTTP '+response.status+'). Copy the exact BRTI_VIEW_TOKEN value from Render Environment and connect again.');
  if(response.status===400||response.status===404)
   throw statusError('NOT DEPLOYED','The recorder API endpoint is missing (HTTP '+response.status+'). Render may still be running an older version: deploy the latest main branch and check /health.');
  if(response.status===429)
   throw statusError('RATE LIMITED','The backend is rate-limited. Retry after '+(response.headers.get('Retry-After')||'30')+' seconds.');
  if(!response.ok)throw statusError('BACKEND ERROR','Recorder backend returned HTTP '+response.status+'. Check the Render logs.');
  try{return binary?response.blob():await response.json();}
  catch{throw statusError('BAD RESPONSE','The backend responded, but did not return valid recorder data. Check the deployed version.');}
 };
 async function refresh(){
  if(statusBusy)return;
  statusBusy=true;
  $('modelRecorderRefresh').disabled=true;
  text('modelRecorderBadge','CONNECTING');
  $('modelRecorderBadge').className='pill warn';
  text('modelRecorderStatus','Contacting recorder backend '+base()+'. A sleeping Render instance may take up to 75 seconds to respond…');
  try{
   const s=await get('/model/status');
   text('modelRecorderBadge',s.status==='recording'?'RECORDING':'CHECK FEED');
   $('modelRecorderBadge').className='pill '+(s.status==='recording'?'up':'warn');
   text('modelRecorderStatus',(s.activeTicker||'Awaiting next BTC15M contract')+
    ' · '+s.totalRounds+' recorded rounds · latest quote '+date(s.lastSampleAt)+
    ' · last write '+date(s.lastWriteAt)+
    (s.lastError?' · issue: '+s.lastError:'')+
    (s.pauseUntil>Date.now()?' · Kalshi cooldown '+Math.ceil((s.pauseUntil-Date.now())/1000)+'s':''));
   text('modelRecorderStorage',(s.mode==='ephemeral_local'?'TEMPORARY STORAGE · ':'Configured path · ')+s.storageWarning);
  }catch(e){
   text('modelRecorderBadge',badgeForError(e));$('modelRecorderBadge').className='pill warn';
   text('modelRecorderStatus',e.message);
   text('modelRecorderStorage','No recorder storage status was retrieved.');
  }finally{statusBusy=false;$('modelRecorderRefresh').disabled=false;}
 }
 function equity(points){
  const svg=$('modelReplayEquity');svg.replaceChildren();
  const NS='http://www.w3.org/2000/svg';
  const node=(tag,attrs,txt)=>{const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(txt!==undefined)n.textContent=txt;svg.append(n);return n;};
  const valid=points.filter(p=>Number.isFinite(p.balance));
  if(valid.length<2){node('text',{x:25,y:92,fill:'#aab7cb','font-size':16},'No completed hypothetical exits to chart yet.');return;}
  const min=Math.min(...valid.map(p=>p.balance)),max=Math.max(...valid.map(p=>p.balance)),pad=Math.max(1,(max-min)*.2);
  const y=v=>155-(v-min+pad)/(max-min+2*pad)*130;
  const x=i=>45+i/(valid.length-1)*680;
  for(let j=0;j<3;j++){
   const price=min-pad+(max-min+2*pad)*j/2,Y=y(price);
   node('line',{x1:45,x2:725,y1:Y,y2:Y,stroke:'#3c5065','stroke-width':1});
   node('text',{x:735,y:Y+4,fill:'#aab7cb','font-size':12},money(price));
  }
  node('polyline',{points:valid.map((p,i)=>x(i)+','+y(p.balance)).join(' '),fill:'none',stroke:'#7cb4f8','stroke-width':2.5});
  node('text',{x:45,y:175,fill:'#aab7cb','font-size':12},'Start');
  node('text',{x:725,y:175,fill:'#aab7cb','font-size':12,'text-anchor':'end'},valid.length-1+' exited trades');
 }
 async function run(){
  $('modelReplayRun').disabled=true;
  text('modelReplayResults','Replaying available recorded observations…');
  try{
   const query=new URLSearchParams({
    bankroll:$('modelReplayBankroll').value,stake:$('modelReplayStake').value,
    fee_cents:$('modelReplayFee').value,rounds:$('modelReplayRounds').value
   });
   const report=await get('/model/replay?'+query);
   const pct=report.winRate===null?'not measurable':(100*report.winRate).toFixed(1)+'%';
   text('modelReplayResults',
    report.rounds+' recorded completed rounds reviewed · '+report.covered.modelEligible+' fully eligible observed snapshots · '+
    report.signalCount+' qualifying model signals · '+report.trades+' hypothetical exited trades · '+report.unresolved+
    ' unresolved · '+report.notFilled+' orders not assumed filled. Starting '+money(report.initialBankroll)+
    ' → ending '+money(report.endingBankroll)+' · net hypothetical P/L '+money(report.pnl)+
    ' · win rate '+pct+' · maximum drawdown '+(100*report.maxDrawdown).toFixed(1)+'%.');
   text('modelReplayCoverage','Coverage: '+report.covered.snapshots+' samples · '+report.covered.flowReady+
    ' complete trade-flow windows · '+report.covered.brtiFresh+' fresh BRTI contexts · '+
    report.covered.modelEligible+' fully model-eligible · '+report.covered.staleBook+' stale books. '+
    'Estimated fee '+$('modelReplayFee').value+'¢ per contract per side. Actual fills and slippage are unverified.');
   equity(report.equity||[]);
   const body=$('modelReplayTrades');body.replaceChildren();
   if(!report.tradeLog?.length){
    const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=8;
    cell.textContent='No eligible completed hypothetical trades. This is insufficient evidence, not a 0% win rate.';row.append(cell);body.append(row);
   }
   for(const trade of (report.tradeLog||[]).slice(-50).reverse()){
    const row=document.createElement('tr');
    for(const val of [date(trade.entryAt),trade.side,(100*trade.entry).toFixed(1)+'¢',
     (100*trade.exit).toFixed(1)+'¢',trade.qty,money(trade.estimatedFees),money(trade.pnl),trade.reason]){
     const cell=document.createElement('td');cell.textContent=String(val);row.append(cell);
    }body.append(row);
   }
  }catch(e){text('modelReplayResults','Replay unavailable: '+e.message);}
  finally{$('modelReplayRun').disabled=false;}
 }
 async function exportData(){
  $('modelRecorderExport').disabled=true;
  try{
   const blob=await get('/model/export?rounds=60',{binary:true});
   const objectUrl=URL.createObjectURL(blob);
   const link=document.createElement('a');link.href=objectUrl;link.download='btc-scalp-recorded-rounds.json';document.body.append(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(objectUrl),10000);
  }catch(e){text('modelRecorderStatus','Export failed: '+e.message);}
  finally{$('modelRecorderExport').disabled=false;}
 }
 $('modelRecorderConnect').onsubmit=e=>{
  e.preventDefault();
  const input=$('modelRecorderToken'),value=input.value.trim();
  if(!value){text('modelRecorderStatus','Enter your private BRTI_VIEW_TOKEN in the field above.');return;}
  try{sessionStorage.setItem('btcBrtiViewToken',value);}
  catch{ text('modelRecorderStatus','This browser tab blocked sessionStorage. Enable site storage to connect securely.');return; }
  input.value='';
  void refresh();
 };
 $('modelRecorderRefresh').onclick=refresh;
 $('modelReplayRun').onclick=run;
 $('modelRecorderExport').onclick=exportData;
 equity([]);
 void refresh();
 setInterval(()=>{if(!document.hidden)void refresh();},30000);
 return panel;
}
