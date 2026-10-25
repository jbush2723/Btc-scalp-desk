// Server-side as-observed BTC15M recorder. No API secrets or private keys are written.
// This recorder runs only while the Node server is awake. Render Free filesystem is EPHEMERAL.
import {mkdir,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {selectMarket,normalizeBook,bookQuote} from './flow.js';

const TICKER=/^KXBTC15M-[A-Z0-9-]{1,60}$/;
const MAX_ROUNDS=120,INTERVAL_MS=5000,MAX_PAGES_PER_WINDOW=15,MAX_TRADE_COUNT=120000;
const safeNumber=x=>Number.isFinite(Number(x))?Number(x):null;
const parsedTime=x=>Date.parse(x||'');
const seconds=x=>Math.floor(x/1000);

export class MarketRecorder {
 constructor({brti,relay,dir=process.env.BTC_RECORDER_DIR||'/tmp/btc-scalp-observations',now=Date.now}={}){
  this.brti=brti;this.relay=relay;this.dir=dir;this.now=now;this.rounds=new Map();
  this.running=false;this.busy=false;this.timer=null;this.current=null;this.lastDiscover=0;
  this.lastMarket=0;this.lastError='';this.lastSampleAt=0;this.recordingSince=null;this.collectorStartedAt=null;
  this.lastFlushAt=0;this.failedWrites=0;this.lastWriteAt=0;this.last429At=0;this.pauseUntil=0;
  this.mode=process.env.BTC_RECORDER_DIR?'configured_directory':'ephemeral_local';
 }
 async start(){
  if(this.running)return;
  this.running=true;this.collectorStartedAt=this.now();
  try{await mkdir(this.dir,{recursive:true});const names=(await readdir(this.dir)).filter(n=>TICKER.test(n.replace(/\.json$/,''))&&n.endsWith('.json')).slice(-MAX_ROUNDS);
   for(const name of names){try{
    const round=JSON.parse(await readFile(join(this.dir,name),'utf8'));
    if(round?.market?.ticker&&TICKER.test(round.market.ticker)&&Array.isArray(round.samples)&&Array.isArray(round.trades)&&Array.isArray(round.brtiTicks))this.rounds.set(round.market.ticker,round);
   }catch{}}
  }catch(e){this.lastError='Recorder filesystem unavailable: '+e.message;}
  this.timer=setInterval(()=>{void this.tick();},INTERVAL_MS);this.timer.unref?.();
  void this.tick();
 }
 async stop(){
  this.running=false;clearInterval(this.timer);this.timer=null;
  for(const round of this.rounds.values())await this.flush(round);
 }
 async api(path){
  const result=await this.relay(path);
  if(result.status!==200){
   if(result.status===429){
    const delay=safeNumber(result.retryAfter);
    this.last429At=this.now();this.pauseUntil=this.now()+Math.max(30000,Math.min(120000,(delay||30)*1000));
   }
   throw Error('Kalshi recorder request HTTP '+result.status);
  }
  return JSON.parse(result.body);
 }
 trim(){
  if(this.rounds.size<=MAX_ROUNDS)return;
  const ordered=[...this.rounds.values()].sort((a,b)=>a.market.closeAt-b.market.closeAt);
  for(const round of ordered.slice(0,this.rounds.size-MAX_ROUNDS))this.rounds.delete(round.market.ticker);
 }
 async discover(now){
  if(this.current&&this.current.market.closeAt>now&&now-this.lastDiscover<45000)return this.current;
  if(now-this.lastDiscover<15000&&this.current?.market.closeAt>now)return this.current;
  this.lastDiscover=now;
  const response=await this.api('/markets?series_ticker=KXBTC15M&status=open&limit=100');
  const next=selectMarket(response.markets||[],now);
  if(!next){if(this.current)await this.flush(this.current);this.current=null;return null;}
  let round=this.rounds.get(next.ticker);
  if(!round){
   round={schema:1,market:{ticker:next.ticker,openAt:parsedTime(next.open_time),closeAt:parsedTime(next.close_time),
      strike:safeNumber(next.floor_strike),price_ranges:next.price_ranges||[]},
    samples:[],trades:[],brtiTicks:[],startedAt:now,updatedAt:now,coverageStart:null,tradeThrough:null,
    failures:0,gaps:0,complete:false,source:'As-recorded server REST orderbook/trade snapshots and authorized CF BRTI'};
   this.rounds.set(next.ticker,round);this.trim();
  }
  if(this.current&&this.current.market.ticker!==round.market.ticker)await this.flush(this.current);
  this.current=round;
  return round;
 }
 async collectTrades(round,now){
  // Incremental windows; gaps are never silently filled. Timestamps are captured
  // at first observation so replay cannot use information received later.
  const through=Math.floor((now-1000)/1000)*1000;
  const start=round.tradeThrough===null?Math.max(round.market.openAt,through-9000):Math.max(round.market.openAt,round.tradeThrough-2000);
  if(through<=start||through-start>120000){round.coverageStart=null;round.tradeThrough=null;return {complete:false,through:0};}
  let cursor='',pages=0,complete=false;const fetched=new Map(),seenCursors=new Set();
  while(pages++<MAX_PAGES_PER_WINDOW){
   const params=new URLSearchParams({ticker:round.market.ticker,limit:'1000',min_ts:String(seconds(start)),
    max_ts:String(seconds(through)),is_block_trade:'false'});
   if(cursor)params.set('cursor',cursor);
   const response=await this.api('/markets/trades?'+params);
   if(!Array.isArray(response.trades))throw Error('Bad trade response');
   for(const trade of response.trades){
    const time=parsedTime(trade.created_time),quantity=safeNumber(trade.count_fp??trade.count);
    if(!trade.trade_id||!Number.isFinite(time)||quantity===null||quantity<=0||time>through||time<round.market.openAt||trade.is_block_trade===true)continue;
    fetched.set(trade.trade_id,{trade_id:trade.trade_id,ticker:round.market.ticker,created_time:trade.created_time,
     count_fp:quantity,taker_outcome_side:trade.taker_outcome_side??trade.taker_side??'unknown',
     yes_price_dollars:trade.yes_price_dollars??null,no_price_dollars:trade.no_price_dollars??null,seenAt:now});
   }
   cursor=response.cursor||'';
   if(!cursor){complete=true;break;}
   if(seenCursors.has(cursor))break;
   seenCursors.add(cursor);
  }
  if(!complete){round.coverageStart=null;round.tradeThrough=null;round.gaps++;return {complete:false,through:0};}
  const already=new Set(round.trades.map(t=>t.trade_id));
  for(const row of fetched.values())if(!already.has(row.trade_id)){round.trades.push(row);already.add(row.trade_id);}
  if(round.trades.length>MAX_TRADE_COUNT){round.trades=round.trades.slice(-MAX_TRADE_COUNT);round.coverageStart=null;}
  if(round.tradeThrough===null||start>round.tradeThrough+2000){
   round.coverageStart=start;
   if(round.tradeThrough!==null)round.gaps++;
  }else if(round.coverageStart===null)round.coverageStart=start;
  round.tradeThrough=through;
  return {complete:true,through};
 }
 async flush(round){
  if(!TICKER.test(round.market.ticker))return;
  try{
   await mkdir(this.dir,{recursive:true});
   const filename=join(this.dir,round.market.ticker+'.json'),tmp=filename+'.tmp';
   await writeFile(tmp,JSON.stringify(round));
   await rename(tmp,filename);this.lastWriteAt=this.now();
  }catch(e){this.failedWrites++;this.lastError='Could not persist recorder data: '+e.message;}
 }
 recordBrti(round,now){
  const history=Array.isArray(this.brti?.history)?this.brti.history:[];
  const last=round.brtiTicks.at(-1)?.time??0;
  for(const row of history)if(row.time>last&&row.time>=round.market.openAt&&row.time<=Math.min(now,round.market.closeAt)&&Number.isFinite(row.value))round.brtiTicks.push({time:row.time,value:row.value});
 }
 async tick(){
  if(!this.running||this.busy||this.now()<this.pauseUntil)return;
  this.busy=true;
  try{
   const now=this.now(),round=await this.discover(now);
   if(!round)return;
   if(round.market.closeAt<=now){await this.flush(round);this.current=null;return;}
   let metadata=null;
   if(now-this.lastMarket>10000){
    try{metadata=(await this.api('/markets/'+round.market.ticker)).market;this.lastMarket=now;}
    catch{} // existing metadata remains; metadata staleness is visible
   }
   if(metadata?.ticker===round.market.ticker){
    round.market.price_ranges=metadata.price_ranges||round.market.price_ranges;
    round.market.strike=safeNumber(metadata.floor_strike)??round.market.strike;
   }
   const data=await this.api('/markets/'+round.market.ticker+'/orderbook?depth=10');
   const observedAt=this.now(),book=normalizeBook(data),quote=bookQuote(book);
   if(!Number.isFinite(quote.yesBid)||!Number.isFinite(quote.yesAsk))throw Error('No complete two-sided order book');
   // Capture the complete trade page window before marking its flow as replayable.
   let flow;
   try{flow=await this.collectTrades(round,observedAt);}
   catch(e){round.coverageStart=null;round.tradeThrough=null;round.gaps++;flow={complete:false,through:0};this.lastError=e.message;}
   const sampleAt=this.now(),feed=this.brti?.snapshot?.()||{status:'unavailable'};
   this.recordBrti(round,sampleAt);
   const fresh=flow.complete&&flow.through&&sampleAt-flow.through<6000&&round.coverageStart!==null&&flow.through-round.coverageStart>=60000;
   round.samples.push({at:sampleAt,bookAt:observedAt,quote,tradeThrough:flow.through,
    flowReady:Boolean(fresh),marketFresh:!!metadata||now-this.lastMarket<=15000,
    brti:{status:feed.status,price:feed.price??null,sourceTime:feed.sourceTime??null,ageMs:feed.ageMs??null}});
   round.updatedAt=sampleAt;this.lastSampleAt=sampleAt;
   if(!this.recordingSince)this.recordingSince=sampleAt;
   if(sampleAt-this.lastFlushAt>=15000){this.lastFlushAt=sampleAt;await this.flush(round);}
   if(flow.complete)this.lastError='';
  }catch(e){this.lastError=e.message;}
  finally{this.busy=false;}
 }
 summary(){
  const rounds=[...this.rounds.values()].sort((a,b)=>a.market.closeAt-b.market.closeAt);
  return {running:this.running,status:this.lastError?'degraded':'recording',lastError:this.lastError,
   mode:this.mode,storageWarning:this.mode==='ephemeral_local'?'Render Free local filesystem is temporary; recordings are lost on restart/deploy/spin-down. Configure durable storage before relying on 24/7 collection.':'Recorder path configured; confirm this path is on a persistent volume.',
   dirConfigured:process.env.BTC_RECORDER_DIR?true:false,
   startedAt:this.collectorStartedAt,lastSampleAt:this.lastSampleAt,lastWriteAt:this.lastWriteAt,
   failedWrites:this.failedWrites,last429At:this.last429At,pauseUntil:this.pauseUntil,
   totalRounds:rounds.length,activeTicker:this.current?.market.ticker||null,
   rounds:rounds.slice(-40).reverse().map(r=>({ticker:r.market.ticker,openAt:r.market.openAt,closeAt:r.market.closeAt,
     samples:r.samples.length,trades:r.trades.length,brtiTicks:r.brtiTicks.length,gaps:r.gaps,firstAt:r.samples[0]?.at||null,
     lastAt:r.samples.at(-1)?.at||null,flowReady:r.samples.filter(s=>s.flowReady).length}))};
 }
 getRounds(limit=30){
  return [...this.rounds.values()].sort((a,b)=>a.market.closeAt-b.market.closeAt).slice(-Math.min(60,Math.max(1,limit)));
 }
}
