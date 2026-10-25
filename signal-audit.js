// Browser-local forward paper marks only. Never assumes fills, quote depth, or continuous execution.
// Existing v1 audit records remain untouched in their old localStorage key.
const KEY='btcScalpSignalAuditV2';
const HORIZON=420000, GAP=15000, MAX=350;
const TARGETS=[15,20,30,40],CHECKS=[30,60,120,300,420];
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>0&&n<1;
const pct=(bid,ask)=>100*(bid/ask-1);
function read(){try{const rows=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(rows)?rows.slice(-MAX):[];}catch{return [];}}
function store(rows){try{localStorage.setItem(KEY,JSON.stringify(rows.slice(-MAX)));}catch{}}
export class SignalAudit{
 constructor(){this.rows=read();}
 observe({ticker,action,score,quote,now,fresh,quoteAt,closeAt}){
  const at=Number.isFinite(quoteAt)?quoteAt:now;
  let changed=false;
  for(const row of this.rows){
   if(row.status!=='tracking')continue;
   if(row.ticker!==ticker){row.status='market_changed';changed=true;continue;}
   if(Number.isFinite(row.closeAt)&&at>=row.closeAt){row.status='closed_before_7m';changed=true;continue;}
   if(!fresh||!quote||at<=row.lastAt)continue;
   if(at-row.lastAt>GAP){row.status='data_gap';changed=true;continue;}
   const bid=row.side==='YES'?quote.yesBid:quote.noBid;
   if(!valid(bid))continue;
   const gross=pct(bid,row.entryAsk);
   row.lastAt=at;row.lastBid=bid;row.minGross=Math.min(row.minGross,gross);row.maxGross=Math.max(row.maxGross,gross);row.samples++;
   for(const target of TARGETS)if(row.hits[target]===null&&gross>=target)row.hits[target]=Math.max(0,Math.round((at-row.at)/1000));
   for(const check of CHECKS){
    if(row.checkpoints[check]!==null||row.missed.includes(check)||at<row.at+check*1000)continue;
    if(at-row.at-check*1000<=GAP)row.checkpoints[check]=gross;
    else row.missed.push(check);
   }
   if(at>=row.at+HORIZON){row.status=at-row.at-HORIZON<=GAP?'complete':'late';row.finalGross=gross;}
   changed=true;
  }
  if(fresh&&ticker&&quote&&Number.isFinite(closeAt)&&closeAt>at){
   const side=action==='UP'?'YES':action==='DOWN'?'NO':null;
   const ask=side==='YES'?quote.yesAsk:quote.noAsk,bid=side==='YES'?quote.yesBid:quote.noBid;
   const id=ticker+':'+side;
   if(side&&valid(ask)&&valid(bid)&&bid<=ask&&!this.rows.some(x=>x.id===id)){
    this.rows.push({id,ticker,side,at,closeAt,entryAsk:ask,score:Number.isFinite(score)?score:null,status:'tracking',lastAt:at,lastBid:bid,
      maxGross:pct(bid,ask),minGross:pct(bid,ask),samples:1,
      hits:Object.fromEntries(TARGETS.map(t=>[t,null])),checkpoints:Object.fromEntries(CHECKS.map(t=>[t,null])),missed:[]});
    this.rows=this.rows.slice(-MAX);changed=true;
   }
  }
  // A stale quote does not count as a valid outcome, and expiry ends observation.
  if(changed)store(this.rows);
  return this.stats();
 }
 stats(){
  const complete=this.rows.filter(x=>x.status==='complete');
  return {complete:complete.length,tracking:this.rows.filter(x=>x.status==='tracking').length,
    partial:this.rows.filter(x=>!['complete','tracking'].includes(x.status)).length,
    hits:Object.fromEntries(TARGETS.map(t=>[t,complete.filter(x=>x.hits[t]!==null).length])),
    rows:this.rows.slice(-10).reverse()};
 }
 csv(){
  const cols=['ticker','side','signal_time_utc','entry_ask_cents','signal_score','status','samples','max_observed_gross_pct','min_observed_gross_pct',
    ...TARGETS.map(x=>'first_'+x+'pct_hit_seconds'),...CHECKS.map(x=>'gross_at_'+x+'sec_pct')];
  const data=this.rows.map(r=>[r.ticker,r.side,new Date(r.at).toISOString(),r.entryAsk*100,r.score??'',r.status,r.samples,r.maxGross,r.minGross,
    ...TARGETS.map(x=>r.hits[x]??''),...CHECKS.map(x=>r.checkpoints[x]??'')]);
  return [cols,...data].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n');
 }
}
export function startSignalAudit(){
 const section=document.createElement('section');section.className='card';
 section.innerHTML='<h2>Scalp audit · up to 7 minutes</h2><p class="small muted">Paper-only observations: first confirmed UP (YES) or DOWN (NO) signal per contract side, entry at the ask, subsequent exits measured at that same side’s bid. Tracks first observed +15%, +20%, +30%, +40% gross return, and marks at 30s, 60s, 120s, 300s and 420s. These are observed quotes, not guaranteed fills. Browser tab must remain visible. A market closing early or a data gap leaves an incomplete sample. No fees, slippage or actual positions included.</p><p id="auditSummary" role="status">Collecting new confirmed signals.</p><div class="table-scroll"><table><thead><tr><th>Contract</th><th>Side</th><th>Status</th><th>Entry ask</th><th>Best observed</th><th>Worst observed</th><th>First +15%</th><th>First +40%</th><th>7m mark</th></tr></thead><tbody id="auditRows"></tbody></table></div><button type="button" class="secondary" id="auditExport">Download scalp audit CSV</button><p class="small muted">Target hit counts use only complete 7-minute observations. Percentages are gross return relative to entry ask, not price changes in cents. Previous 60-second audit data remains in this browser’s older storage key.</p>';
 document.querySelector('#signalCard').insertAdjacentElement('afterend',section);
 const audit=new SignalAudit();
 section.querySelector('#auditExport').onclick=()=>{
  const blob=new Blob([audit.csv()],{type:'text/csv'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='btc-scalp-audit-7min.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 return info=>{
  const s=audit.observe(info);
  const count=t=>s.complete?s.hits[t]+'/'+s.complete+' ('+(100*s.hits[t]/s.complete).toFixed(0)+'%)':'—';
  section.querySelector('#auditSummary').textContent=s.complete+' complete 7m samples · '+s.tracking+' tracking · '+s.partial+' incomplete · observed +15%: '+count(15)+' · +40%: '+count(40);
  const tbody=section.querySelector('#auditRows');tbody.replaceChildren();
  for(const r of s.rows){
   const tr=document.createElement('tr');
   const percent=n=>Number.isFinite(n)?(n>=0?'+':'')+n.toFixed(1)+'%':'—';
   const cells=[r.ticker,r.side,r.status,(r.entryAsk*100).toFixed(1)+'¢',percent(r.maxGross),percent(r.minGross),
     r.hits[15]===null?'—':r.hits[15]+'s',r.hits[40]===null?'—':r.hits[40]+'s',percent(r.checkpoints[420])];
   for(const value of cells){const td=document.createElement('td');td.textContent=value;tr.append(td);}
   tbody.append(tr);
  }
 };
}
