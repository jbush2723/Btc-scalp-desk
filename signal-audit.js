// Forward-only, browser-local paper tracking. A quote is not a fill.
const KEY='btcScalpSignalAuditV1';
const HORIZON=60000,MAX=500;
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1;
function read(){try{const x=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(x)?x.filter(y=>y&&typeof y.id==='string').slice(-MAX):[];}catch{return [];}}
function write(x){try{localStorage.setItem(KEY,JSON.stringify(x.slice(-MAX)));}catch{}}
export class SignalAudit{
  constructor(){this.rows=read();this.lastCapture=new Map();}
  observe({ticker,action,score,quote,now,fresh}){
    if(!ticker||!fresh||!quote)return this.stats();
    // Evaluate existing observations against future executable bid quotes, never midpoint or ask.
    for(const item of this.rows){
      if(item.status!=='pending'||item.ticker!==ticker||now<item.due)continue;
      const bid=item.side==='YES'?quote.yesBid:quote.noBid;
      if(valid(bid)){
        item.exitBid=bid;item.deltaCents=Math.round((bid-item.entryAsk)*10000)/100;
        item.status='marked';item.markAt=now;
      }
    }
    const side=action==='UP'?'YES':action==='DOWN'?'NO':null;
    const ask=side==='YES'?quote.yesAsk:quote.noAsk;
    const bid=side==='YES'?quote.yesBid:quote.noBid;
    if(side&&valid(ask)&&valid(bid)&&ask>=bid){
      // One independent observation per ticker/side, avoiding hundreds of correlated copies.
      const id=ticker+':'+side;
      if(!this.rows.some(x=>x.id===id)){
        this.rows.push({id,ticker,side,at:now,due:now+HORIZON,entryAsk:ask,entryBid:bid,score:Number.isFinite(score)?score:null,status:'pending'});
      }
    }
    write(this.rows);
    return this.stats();
  }
  stats(){
    const done=this.rows.filter(x=>x.status==='marked'&&Number.isFinite(x.deltaCents));
    const pending=this.rows.filter(x=>x.status==='pending');
    const wins=done.filter(x=>x.deltaCents>0).length;
    const mean=done.length?done.reduce((s,x)=>s+x.deltaCents,0)/done.length:null;
    return {total:done.length,pending:pending.length,wins,mean,rows:this.rows.slice(-8).reverse()};
  }
  csv(){
    const columns=['ticker','side','signal_at','entry_ask_cents','signal_score','mark_at','exit_bid_cents','gross_change_cents','status'];
    const rows=this.rows.map(r=>[r.ticker,r.side,new Date(r.at).toISOString(),r.entryAsk*100,r.score??'',r.markAt?new Date(r.markAt).toISOString():'',r.exitBid==null?'':r.exitBid*100,r.deltaCents??'',r.status]);
    return [columns,...rows].map(a=>a.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\n');
  }
}
export function startSignalAudit(){
  const section=document.createElement('section');section.className='card';
  section.innerHTML='<h2>Signal audit · 60-second paper marks</h2><p class="small muted">Logs the first confirmed UP and DOWN call separately per contract in this browser. Assumes hypothetical entry at the current ask and marks against the same side’s bid at the first fresh observation at least 60 seconds later. No execution, fees, or fill is implied. Keep this tab open to collect marks. Unmarked samples are excluded.</p><p id="auditSummary" role="status">Waiting for confirmed signals.</p><div class="table-scroll"><table><thead><tr><th>Contract</th><th>Side</th><th>Entry ask</th><th>After 60s bid</th><th>Gross change</th></tr></thead><tbody id="auditRows"></tbody></table></div><button type="button" class="secondary" id="auditExport">Download audit CSV</button>';
  document.querySelector('#signalCard').insertAdjacentElement('afterend',section);
  const audit=new SignalAudit();
  section.querySelector('#auditExport').onclick=()=>{
    const blob=new Blob([audit.csv()],{type:'text/csv'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='btc-signal-audit.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return info=>{
    const s=audit.observe(info);
    const pct=s.total?(100*s.wins/s.total).toFixed(0)+'%':'—';
    section.querySelector('#auditSummary').textContent=s.total+' marked · '+s.pending+' pending · '+pct+' positive gross marks · mean '+(s.mean==null?'—':s.mean.toFixed(2)+'¢')+' (before fees)';
    const tbody=section.querySelector('#auditRows');tbody.replaceChildren();
    for(const x of s.rows){const tr=document.createElement('tr');
      for(const value of [x.ticker,x.side,(x.entryAsk*100).toFixed(1)+'¢',x.exitBid==null?'Pending':(x.exitBid*100).toFixed(1)+'¢',x.deltaCents==null?'—':(x.deltaCents>0?'+':'')+x.deltaCents.toFixed(2)+'¢']){
        const td=document.createElement('td');td.textContent=value;tr.append(td);
      }tbody.append(tr);
    }
  };
}
