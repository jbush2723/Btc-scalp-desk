// Browser-local paper observations; never assumes that an observed quote was filled.
// Retain existing V2 localStorage records and preserve legacy statuses.
const KEY='btcScalpSignalAuditV2';
const HORIZON=420000,GAP=15000,FINAL_MINUTE=60000,MAX=350;
const TARGETS=[15,20,30,40],CHECKS=[30,60,120,300,420];
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>0&&n<1;
const pct=(bid,ask)=>100*(bid/ask-1);
const deadline=row=>Math.min(row.at+HORIZON,row.closeAt-FINAL_MINUTE);
const timeOrBlank=at=>Number.isFinite(at)?new Date(at).toISOString():'';
function read(){try{const rows=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(rows)?rows.slice(-MAX):[];}catch{return [];}}
function store(rows){try{localStorage.setItem(KEY,JSON.stringify(rows.slice(-MAX)));}catch{}}
export class SignalAudit{
 constructor(){this.rows=read();}
 observe({ticker,action,score,quote,now=Date.now(),fresh,quoteAt,closeAt}){
  // A 0 bookAt during rollover is NOT a real quote timestamp.
  const at=Number.isFinite(quoteAt)&&quoteAt>0?quoteAt:now;
  let changed=false;
  for(const row of this.rows){
   if(row.status!=='tracking')continue;
   const exitAt=deadline(row),sevenMinutes=exitAt===row.at+HORIZON;
   // Update a same-contract observation, but never include a quote from after
   // our intended exit deadline or from a new contract.
   if(ticker===row.ticker&&fresh&&quote&&at>row.lastAt&&at<=exitAt){
    if(at-row.lastAt>GAP){row.status='data_gap';changed=true;continue;}
    const bid=row.side==='YES'?quote.yesBid:quote.noBid;
    if(valid(bid)){
     const gross=pct(bid,row.entryAsk);
     row.lastAt=at;row.lastBid=bid;row.minGross=Math.min(row.minGross,gross);
     row.maxGross=Math.max(row.maxGross,gross);row.samples++;
     for(const target of TARGETS)if(row.hits[target]===null&&gross>=target)
      row.hits[target]=Math.max(0,Math.round((at-row.at)/1000));
     for(const check of CHECKS){
      if(row.checkpoints[check]!==null||row.missed.includes(check)||at<row.at+check*1000)continue;
      if(at-row.at-check*1000<=GAP)row.checkpoints[check]=gross;
      else row.missed.push(check);
     }
     changed=true;
    }
   }
   // An observed bid within the final 15 seconds BEFORE the deadline is a
   // marked hypothetical exit. This is not proof of a sell fill at the deadline.
   if(now>=exitAt&&Number.isFinite(row.lastAt)&&row.lastAt<=exitAt&&
     row.lastAt>=exitAt-GAP&&valid(row.lastBid)){
    row.status=sevenMinutes?'complete':'cutoff_exit';
    row.exitReason=sevenMinutes?'seven_minute_limit':'one_minute_before_close';
    row.exitAt=row.lastAt;row.exitBid=row.lastBid;
    row.finalGross=pct(row.lastBid,row.entryAsk);
    if(sevenMinutes)row.checkpoints[420]=row.finalGross;
    changed=true;continue;
   }
   if(now>=row.closeAt){
    row.status='market_closed';changed=true;continue;
   }
   // The old code marked market_changed even when ticker became null during
   // a normal rollover. Only a *different* active contract is a true change.
   if(ticker&&ticker!==row.ticker){
    row.status=now>=row.closeAt-FINAL_MINUTE?'market_closed':'market_changed';
    changed=true;continue;
   }
   if(now>exitAt+GAP){
    row.status='exit_quote_missing';changed=true;continue;
   }
   if(now-row.lastAt>GAP&&now<exitAt){
    row.status='data_gap';changed=true;
   }
  }
  if(fresh&&ticker&&quote&&Number.isFinite(closeAt)&&closeAt-at>FINAL_MINUTE){
   const side=action==='UP'?'YES':action==='DOWN'?'NO':null;
   const ask=side==='YES'?quote.yesAsk:quote.noAsk,bid=side==='YES'?quote.yesBid:quote.noBid;
   const id=ticker+':'+side;
   if(side&&valid(ask)&&valid(bid)&&bid<=ask&&!this.rows.some(x=>x.id===id)){
    const plannedExit=Math.min(at+HORIZON,closeAt-FINAL_MINUTE);
    this.rows.push({id,ticker,side,at,closeAt,plannedExit,entryAsk:ask,
     score:Number.isFinite(score)?score:null,status:'tracking',lastAt:at,lastBid:bid,
     maxGross:pct(bid,ask),minGross:pct(bid,ask),samples:1,
     hits:Object.fromEntries(TARGETS.map(t=>[t,null])),
     checkpoints:Object.fromEntries(CHECKS.map(t=>[t,null])),missed:[]});
    this.rows=this.rows.slice(-MAX);changed=true;
   }
  }
  if(changed)store(this.rows);
  return this.stats();
 }
 stats(){
  const complete=this.rows.filter(x=>x.status==='complete');
  const early=this.rows.filter(x=>x.status==='cutoff_exit');
  return {complete:complete.length,shortened:early.length,
   tracking:this.rows.filter(x=>x.status==='tracking').length,
   partial:this.rows.filter(x=>!['complete','cutoff_exit','tracking'].includes(x.status)).length,
   hits:Object.fromEntries(TARGETS.map(t=>[t,complete.filter(x=>x.hits?.[t]!=null).length])),
   rows:this.rows.slice(-10).reverse()};
 }
 csv(){
  const cols=['ticker','side','signal_time_utc','entry_ask_cents','signal_score','status','samples',
   'max_observed_gross_pct','min_observed_gross_pct',
   ...TARGETS.map(x=>'first_'+x+'pct_hit_seconds'),
   ...CHECKS.map(x=>'gross_at_'+x+'sec_pct'),
   'scheduled_exit_utc','observed_exit_utc','observed_exit_bid_cents','observed_exit_gross_pct','exit_reason'];
  const data=this.rows.map(r=>[r.ticker,r.side,timeOrBlank(r.at),r.entryAsk*100,r.score??'',
   r.status,r.samples,r.maxGross,r.minGross,
   ...TARGETS.map(x=>r.hits?.[x]??''),...CHECKS.map(x=>r.checkpoints?.[x]??''),
   timeOrBlank(Number.isFinite(r.plannedExit)?r.plannedExit:deadline(r)),
   timeOrBlank(r.exitAt),Number.isFinite(r.exitBid)?r.exitBid*100:'',
   r.finalGross??'',r.exitReason??'']);
  return [cols,...data].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n');
 }
}
export function startSignalAudit(){
 const section=document.createElement('section');section.className='card';
 section.innerHTML='<h2>Scalp audit · seven-minute / pre-close exits</h2><p class="small muted">Paper-only: first confirmed UP (YES) or DOWN (NO) signal per contract side, hypothetical entry at the observed ask and returns marked at the same side’s bid. Planned exit is the earlier of seven minutes after the signal and one minute before contract close. The last bid within 15 seconds BEFORE the exit cutoff is used as an approximate exit mark, not a guaranteed fill. Incomplete samples and early-cutoff exits are not mixed into the full seven-minute hit rate. Browser tab must remain visible; fees and slippage are excluded.</p><p id="auditSummary" role="status">Collecting new confirmed signals.</p><div class="table-scroll"><table><thead><tr><th>Contract</th><th>Side</th><th>Status</th><th>Entry ask</th><th>Best observed</th><th>Worst observed</th><th>First +15%</th><th>First +40%</th><th>Scheduled exit mark</th></tr></thead><tbody id="auditRows"></tbody></table></div><button type="button" class="secondary" id="auditExport">Download scalp audit CSV</button><p class="small muted">Full 7m hit counts exclude one-minute-before-close exits and interrupted observations. Old records retain their original status; no missing historical quotes are reconstructed.</p>';
 document.querySelector('#signalCard').insertAdjacentElement('afterend',section);
 const audit=new SignalAudit();
 section.querySelector('#auditExport').onclick=()=>{
  const blob=new Blob([audit.csv()],{type:'text/csv'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='btc-scalp-audit-7min.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 return info=>{
  const s=audit.observe(info);
  const count=t=>s.complete?s.hits[t]+'/'+s.complete+' ('+(100*s.hits[t]/s.complete).toFixed(0)+'%)':'—';
  section.querySelector('#auditSummary').textContent=s.complete+' full 7m samples · '+s.shortened+
   ' pre-close exits · '+s.tracking+' tracking · '+s.partial+' incomplete · full-7m observed +15%: '+count(15)+
   ' · +40%: '+count(40);
  const tbody=section.querySelector('#auditRows');tbody.replaceChildren();
  for(const r of s.rows){
   const tr=document.createElement('tr');
   const percent=n=>Number.isFinite(n)?(n>=0?'+':'')+n.toFixed(1)+'%':'—';
   const cells=[r.ticker,r.side,r.status,(r.entryAsk*100).toFixed(1)+'¢',
    percent(r.maxGross),percent(r.minGross),
    r.hits?.[15]==null?'—':r.hits[15]+'s',r.hits?.[40]==null?'—':r.hits[40]+'s',
    percent(r.finalGross)];
   for(const value of cells){const td=document.createElement('td');td.textContent=value;tr.append(td);}
   tbody.append(tr);
  }
 };
}
