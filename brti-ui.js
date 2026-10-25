const labels={setup_required:'Key setup needed',connecting:'Connecting to Kalshi',waiting_for_data:'Connected · waiting for BRTI',access_denied:'Kalshi denied access · check key and account permissions',subscription_denied:'Kalshi did not accept the BRTI subscription',configuration_error:'Check the saved key file and Key ID',connection_error:'Connection interrupted · retrying',reconnecting:'Reconnecting',stale:'BRTI data is stale',local_only:'Live BRTI is available on your local dashboard',backend_required:'Open your local dashboard to connect BRTI',unavailable:'BRTI connection unavailable'};
const usd=n=>n.toLocaleString('en-US',{style:'currency',currency:'USD'});
export function startBrti(getBase){
  const el=id=>document.getElementById(id);let tick=null,receivedAt=0,busy=false;
  function render(){
    const age=tick&&Number.isFinite(tick.ageMs)?tick.ageMs+performance.now()-receivedAt:Infinity;
    const fresh=tick?.status==='live'&&Number.isFinite(tick.price)&&tick.price>0&&Number.isFinite(tick.sourceTime)&&age>=0&&age<=5000;
    el('brtiLivePrice').textContent=fresh?usd(tick.price):'—';
    el('brtiStatus').textContent=fresh?'LIVE · CF BRTI':labels[tick?.status==='live'?'stale':tick?.status]||'Connecting';
    el('brtiStatus').className='pill '+(fresh?'up':'warn');
    el('brtiTime').textContent=fresh?'Source updated '+new Date(tick.sourceTime).toLocaleTimeString()+' · '+Math.floor(age/1000)+'s ago':'No fresh official BRTI price available. No spot-price substitute is used.';
    el('brtiAverage').textContent=fresh&&tick.average?usd(tick.average.value)+' · '+tick.average.samples+'/60 samples':'—';
    const svg=el('brtiChart');svg.replaceChildren();
    const points=fresh&&Array.isArray(tick.history)?tick.history.filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.value)&&p.value>0):[];
    if(points.length<2)return;
    const start=points[0].time,end=points.at(-1).time;if(end<=start)return;
    const values=points.map(p=>p.value),lo=Math.min(...values),hi=Math.max(...values),pad=Math.max((hi-lo)*.1,1);
    const y=v=>180-(v-lo+pad)/(hi-lo+2*pad)*160;
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
      const r=await fetch(base.replace(/\/$/,'')+'/brti',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(5000)});
      const next=await r.json();if(base!==getBase())return;tick=next;receivedAt=started;
    }catch{tick={status:'unavailable'};}finally{busy=false;render();}
  }
  void poll();setInterval(()=>void poll(),1000);setInterval(render,500);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void poll();});
}
