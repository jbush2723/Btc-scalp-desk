const $=id=>document.getElementById(id), n=id=>$(id).value.trim()===''?NaN:Number($(id).value);
function calc(){
  const p=n('brti'),t=n('target'),e=n('entry'),x=n('exit'),q=n('qty'),b=n('bids'),a=n('asks');
  const valid=p>0&&t>0,d=p-t;
  $('distance').textContent=valid?(d>=0?'+':'')+d.toFixed(2)+' USD':'—';
  $('distance').className='big '+(valid?(d>=0?'up':'down'):'');
  $('signal').textContent=valid?'Manual observation · '+(d>=0?'above':'below')+' target':'Enter BRTI and target';
  $('gain').textContent=e>0&&e<=100&&x>=0&&x<=100&&q>0?((x-e)/e*100).toFixed(1)+'% · $'+((x-e)*q/100).toFixed(2):'—';
  $('imbalance').textContent=b>=0&&a>=0&&b+a>0?((b-a)/(b+a)*100).toFixed(1)+'%':'—';
}
for(const id of ['brti','target','time','entry','exit','qty','bids','asks']) $(id).addEventListener('input',calc);
function read(){try{const value=JSON.parse(localStorage.getItem('btcScalpJournal')||'[]');return Array.isArray(value)?value.filter(x=>x&&typeof x==='object').slice(0,50):[];}catch{return [];}}
function render(){const data=read();$('history').replaceChildren(...data.map(x=>{const p=document.createElement('p');p.textContent=String(x.when||'')+' · BRTI '+String(x.brti||'')+' · target '+String(x.target||'')+' · '+String(x.note||'');return p;}));if(!data.length)$('history').textContent='No saved snapshots';}
$('save').onclick=()=>{const data=read();data.unshift({when:new Date().toLocaleString(),brti:$('brti').value,target:$('target').value,note:$('note').value});try{localStorage.setItem('btcScalpJournal',JSON.stringify(data.slice(0,50)));render();}catch{$('history').textContent='Browser storage unavailable. Snapshot was not saved.';}};
$('clear').onclick=()=>{if(confirm('Clear local journal?')){try{localStorage.removeItem('btcScalpJournal');render();}catch{$('history').textContent='Browser storage unavailable.';}}};
calc();render();
