// Supplemental context only: free CryptoMeter rapid-movements detects upward moves, not a symmetric direction forecast.
export function startCryptometer(getBase){
  const target=document.querySelector('#brtiHeading')?.closest('section');
  if(!target)return;
  const section=document.createElement('section');
  section.className='card';
  section.setAttribute('aria-label','Cryptometer BTC market context');
  section.innerHTML='<div class="section-head"><h2>Cryptometer · BTC rapid movements</h2><span class="pill" id="cryptoBadge">Checking…</span></div><p id="cryptoSummary" role="status">Checking the free Cryptometer feed.</p><div id="cryptoEvents" class="small muted"></div><p class="small muted">Supplemental exchange-wide upward-movement alerts from the last four hours. No alerts does not imply a DOWN signal. These alerts are not official BRTI, do not determine Kalshi settlement, and do not change the rule-based trading signal.</p>';
  target.insertAdjacentElement('afterend',section);
  const badge=section.querySelector('#cryptoBadge'),summary=section.querySelector('#cryptoSummary'),events=section.querySelector('#cryptoEvents');
  let active=false;
  async function refresh(){
    if(document.hidden||active)return;
    active=true;
    try{
      const base=getBase();
      if(!base||!/^https?:/.test(base))throw Error('Connect the backend');
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),9000);
      let response;
      try{response=await fetch(base+'/cryptometer',{signal:controller.signal,cache:'no-store'});}
      finally{clearTimeout(timeout);}
      if(!response.ok)throw Error('Feed temporarily unavailable');
      const data=await response.json();
      events.replaceChildren();
      if(data.status==='not_configured'){badge.textContent='Key needed';summary.textContent='Set CRYPTOMETER_API_KEY in your Render environment.';return;}
      if(data.status!=='ok')throw Error('Feed unavailable');
      badge.textContent='Connected';
      const recent=(data.events||[]).filter(x=>Date.now()-Date.parse(x.timestamp)<4*3600_000 && Date.parse(x.timestamp)<=Date.now()+60000);
      summary.textContent=recent.length ? recent.length+' BTC upward-move alert(s) found in the returned feed.' : 'No recent BTC upward-move alerts found in the returned feed.';
      for(const item of recent.slice(0,8)){
        const p=document.createElement('p');
        p.textContent=item.pair+' · '+item.exchange+' · '+item.change.toFixed(2)+'% · '+new Date(item.timestamp).toLocaleTimeString();
        events.append(p);
      }
    }catch{badge.textContent='Unavailable';summary.textContent='Cryptometer feed not available right now; Kalshi signals still work independently.';events.replaceChildren();}
    finally{active=false;}
  }
  refresh();
  setInterval(refresh,120000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
}
