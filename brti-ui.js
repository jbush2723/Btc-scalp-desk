const labels={setup_required:'Key setup needed',connecting:'Connecting to Kalshi',waiting_for_data:'Connected · waiting for BRTI',access_denied:'Kalshi denied access · check key and account permissions',subscription_denied:'Kalshi did not accept the BRTI subscription',configuration_error:'Check the saved key file and Key ID',connection_error:'Connection interrupted · retrying',reconnecting:'Reconnecting',stale:'BRTI data is stale',local_only:'Live BRTI is available on your local dashboard',backend_required:'Open your local dashboard to connect BRTI',private_access_required:'Private BRTI access required',unavailable:'BRTI connection unavailable'};
const usd=n=>n.toLocaleString('en-US',{style:'currency',currency:'USD'});
export function startBrti(getBase,getTarget=()=>null){
  const el=id=>document.getElementById(id);let tick=null,receivedAt=0,busy=false;
  let viewToken='';
  try{viewToken=sessionStorage.getItem('btcBrtiViewToken')||'';}catch{}
  const section=el('brtiHeading')?.closest('section');
  const login=document.createElement('form');
  login.innerHTML='<label for="brtiViewerToken">Private BRTI viewing token (from Render BRTI_VIEW_TOKEN)</label><div class="toolbar"><input type="password" id="brtiViewerToken" autocomplete="off" placeholder="Enter private viewing token"><button type="submit">Connect BRTI</button></div><p class="small muted">Stored only in this browser tab for this session. Do not enter your Kalshi API key or private key here.</p>';
  section?.append(login);
  const field=login.querySelector('input');
  login.onsubmit=e=>{e.preventDefault();viewToken=field.value.trim();try{if(viewToken)sessionStorage.setItem('btcBrtiViewToken',viewToken);else sessionStorage.removeItem('btcBrtiViewToken');}catch{}void poll();};

  function render(){
    const age=tick&&Number.isFinite(tick.ageMs)?tick.ageMs+performance.now()-receivedAt:Infinity;
    const fresh=tick?.status==='live'&&Number.isFinite(tick.price)&&tick.price>0&&Number.isFinite(tick.sourceTime)&&age>=0&&age<=5000;
    el('brtiLivePrice').textContent=fresh?usd(tick.price):'—';
    const target=getTarget(),targetValid=Number.isFinite(target?.price)&&target.price>0;
    el('brtiTarget').textContent=targetValid?usd(target.price):'—';
    el('brtiTargetContract').textContent=targetValid?target.ticker:'Waiting for the current contract target';
    const distance=fresh&&targetValid?tick.price-target.price:null;
    el('brtiDistance').textContent=distance===null?'—':Math.abs(distance)<.005?'→ At target':(distance>0?'↑ ':'↓ ')+usd(Math.abs(distance))+(distance>0?' above target':' below target');
    el('brtiDistance').className='big '+(distance===null||Math.abs(distance)<.005?'muted':distance>0?'up':'down');
    el('brtiStatus').textContent=fresh?'LIVE · CF BRTI':labels[tick?.status==='live'?'stale':tick?.status]||'Connecting';
    el('brtiStatus').className='pill '+(fresh?'up':'warn');
    el('brtiTime').textContent=fresh?'Source updated '+new Date(tick.sourceTime).toLocaleTimeString()+' · '+Math.floor(age/1000)+'s ago':'No fresh official BRTI price available. No spot-price substitute is used.';
    el('brtiAverage').textContent=fresh&&tick.average?usd(tick.average.value)+' · '+tick.average.samples+'/60 samples':'—';
    const svg=el('brtiChart');svg.replaceChildren();
    const points=fresh&&Array.isArray(tick.history)?tick.history.filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.value)&&p.value>0):[];
    if(points.length<2)return;
    const start=points[0].time,end=points.at(-1).time;if(end<=start)return;
    const values=points.map(p=>p.value);if(targetValid)values.push(target.price);
    const lo=Math.min(...values),hi=Math.max(...values),pad=Math.max((hi-lo)*.15,1);
    const y=v=>180-(v-lo+pad)/(hi-lo+2*pad)*160;
    if(targetValid){
      const line=document.createElementNS('http://www.w3.org/2000/svg','line');
      for(const [key,value] of Object.entries({x1:20,x2:680,y1:y(target.price),y2:y(target.price),stroke:'#ffcd73','stroke-width':1.5,'stroke-dasharray':'7 5','data-role':'target'}))line.setAttribute(key,value);
      svg.append(line);
      const label=document.createElementNS('http://www.w3.org/2000/svg','text');
      for(const [key,value] of Object.entries({x:24,y:y(target.price)-6,fill:'#ffcd73','font-size':12}))label.setAttribute(key,value);
      label.textContent='Target '+usd(target.price);svg.append(label);
    }
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',points.map((p,i)=>(i?'L':'M')+(20+(p.time-start)/(end-start)*660).toFixed(1)+','+y(p.value).toFixed(1)).join(' '));
    path.setAttribute('fill','none');path.setAttribute('stroke','#46dfa5');path.setAttribute('stroke-width','2');svg.append(path);
    for(const value of [lo,hi]){const label=document.createElementNS('http://www.w3.org/2000/svg','text');label.setAttribute('x','690');label.setAttribute('y',y(value));label.setAttribute('fill','#aab7cb');label.setAttribute('font-size','12');label.textContent=usd(value);svg.append(label);}
  }
  async function poll(){
    if(busy||document.hidden)return;busy=true;
    const base=getBase(),started=performance.now();
    try{
      if(new URL(base,location.href).hostname.endsWith('kalshi.com')){tick={status:'backend_required'};return;}
      const r=await fetch(base.replace(/\/$/,'')+'/brti',{cache:'no-store',credentials:'omit',headers:viewToken?{'X-BRTI-Token':viewToken}:{},signal:AbortSignal.timeout(5000)});
      const next=await r.json();if(base!==getBase())return;tick=next;receivedAt=started;if(next.status==='private_access_required')login.hidden=false;else if(['live','waiting_for_data','connecting'].includes(next.status))login.hidden=true;
    }catch{tick={status:'unavailable'};}finally{busy=false;render();}
  }
  void poll();setInterval(()=>void poll(),1000);setInterval(render,500);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void poll();});
}
