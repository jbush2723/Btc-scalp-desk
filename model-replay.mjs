// Conservative replay of the EXACT live SignalEngine, BRTI veto and suggestPlan.
// Uses ONLY server-as-observed timestamps. No historical candles are interpolated.
// Quote fills are still hypotheses: book updates do not prove execution queue priority.
import {SignalEngine} from './signal.js';
import {TradeFlow,WINDOWS} from './flow.js';
import {evaluateBrtiContext,applyBrtiVeto} from './market-context.js';
import {suggestPlan} from './plan.js';

const numeric=(x,defaultValue)=>Number.isFinite(Number(x))?Number(x):defaultValue;
const isValidQuote=q=>q&&Number.isFinite(q.yesBid)&&Number.isFinite(q.yesAsk)&&
 q.yesAsk>=q.yesBid&&Number.isFinite(q.noBid)&&Number.isFinite(q.noAsk)&&
 q.noAsk>=q.noBid&&Number.isFinite(q.yesAskSize)&&Number.isFinite(q.noAskSize);

function asOfBrti(round,sample){
 const state=sample.brti;
 if(state?.status!=='live'||!Number.isFinite(state.price)||!Number.isFinite(state.sourceTime)||
    !Number.isFinite(state.ageMs)||state.ageMs>5000||sample.at-state.sourceTime>8000)return null;
 const history=round.brtiTicks.filter(t=>t.time<=state.sourceTime&&t.time>=state.sourceTime-46000);
 return {status:'live',price:state.price,sourceTime:state.sourceTime,ageMs:state.ageMs,history};
}

function replayRound(round,{balance,stake,feeCents}){
 const ticker=round.market?.ticker,closeAt=round.market?.closeAt,openedAt=round.market?.openAt;
 const samples=(round.samples||[]).slice().sort((a,b)=>a.at-b.at);
 const trades=(round.trades||[]).slice().sort((a,b)=>a.seenAt-b.seenAt);
 const coverage={snapshots:samples.length,flowReady:0,freshBook:0,brtiFresh:0,modelEligible:0,
  brtiMissing:0,flowMissing:0,staleBook:0};
 const result={ticker,closeAt,coverage,signals:[],trade:null,notFilled:false,unresolved:false,reason:'No confirmed setup in recorded data.'};
 if(!ticker||!Number.isFinite(closeAt)||!Number.isFinite(openedAt)||!samples.length)return result;
 const engine=new SignalEngine(),flow=new TradeFlow();flow.reset(ticker);
 const market={ticker,close_time:new Date(closeAt).toISOString(),price_ranges:round.market.price_ranges||[]};
 let cursor=0,pending=null,position=null,attempted=false;
 for(const sample of samples){
  const now=sample.at;
  if(now>closeAt||now<openedAt)continue;
  // Introduce a trade only after the recorder observed it, not merely after its
  // exchange-created timestamp. This prevents future-data leakage.
  const additions=[];
  while(cursor<trades.length&&trades[cursor].seenAt<=now){additions.push(trades[cursor]);cursor++;}
  if(additions.length)flow.add(additions,now);
  const q=sample.quote,bookFresh=now-sample.bookAt<=6000&&now-sample.bookAt>=0&&isValidQuote(q);
  const flowFresh=sample.flowReady&&now-sample.tradeThrough<6000&&now-sample.tradeThrough>=0;
  const feed=asOfBrti(round,sample),brti=feed?evaluateBrtiContext(feed,round.market.strike):null;
  if(bookFresh)coverage.freshBook++;else coverage.staleBook++;
  if(flowFresh)coverage.flowReady++;else coverage.flowMissing++;
  if(feed&&brti?.changePercent!==null)coverage.brtiFresh++;else coverage.brtiMissing++;
  if(!bookFresh){if(pending)pending=null;continue;}
  engine.record(q,sample.bookAt);
  // Mark an incomplete trade window as unavailable instead of treating its
  // observed partial volumes as evidence for a directional signal.
  const ready=bookFresh&&flowFresh&&sample.marketFresh;
  const base=engine.evaluate({now,ready,seconds:(closeAt-now)/1000,totals:WINDOWS.map(w=>flow.totals(w,now))});
  const reading=applyBrtiVeto(base,brti);
  const strict=ready&&feed&&brti.changePercent!==null;
  if(strict)coverage.modelEligible++;
  if(position){
   const bid=q[position.side+'Bid'],size=q[position.side+'BidSize'];
   const reason=bid<=position.stop?'STOP':bid>=position.target?'TARGET':
    now-position.entryAt>=420000?'7-MINUTE TIME LIMIT':closeAt-now<=60000?'FINAL MINUTE':null;
   if(reason){
    if(!Number.isFinite(bid)||!Number.isFinite(size)||size<position.qty){
     result.unresolved=true;result.reason='Exit liquidity was not observed at the decision time; cannot assert a complete fill.';
    }else{
     const exitFee=feeCents/100*position.qty;
     const pnl=position.qty*(bid-position.entry)-position.entryFee-exitFee;
     result.trade={ticker,signalAt:position.signalAt,entryAt:position.entryAt,exitAt:now,
      side:position.side.toUpperCase(),entry:position.entry,exit:bid,qty:position.qty,
      estimatedFees:position.entryFee+exitFee,pnl,reason,
      note:'Hypothetical next-observation quote fills; queue priority and slippage unknown.'};
     result.reason='Simulated trade exited at observed best bid. Fill is NOT verified.';
    }
    position=null;break;
   }
   // If the book disappears or the contract closes, do not fabricate an exit.
   continue;
  }
  if(pending){
   const item=pending;pending=null;
   if(now-item.signalAt>8000||now<=item.signalAt){result.notFilled=true;result.reason='No next quote within 8 seconds of the signal.';attempted=true;continue;}
   const ask=q[item.plan.side+'Ask'],available=q[item.plan.side+'AskSize'],bid=q[item.plan.side+'Bid'];
   const fee=feeCents/100;
   const qty=Math.floor(Math.min(available,stake/(ask+fee),balance/(ask+fee)));
   if(!Number.isFinite(ask)||!Number.isFinite(available)||!Number.isFinite(bid)||ask<=0||
      ask>item.plan.entry+1e-8||qty<1||ask-bid>.03000001){
    result.notFilled=true;result.reason='Next observed ask exceeded the entry limit, available size, or spread restriction.';attempted=true;continue;
   }
   attempted=true;
   position={signalAt:item.signalAt,entryAt:now,entry:ask,side:item.plan.side,qty,
    entryFee:fee*qty,stop:item.plan.stop,target:item.plan.target};
   result.reason='Hypothetical entry; awaiting observed exit bid.';
   continue;
  }
  // We count only fully observed candidates. Missing BRTI is not a pass.
  if(!strict||attempted||!['UP','DOWN'].includes(reading.action))continue;
  const plan=suggestPlan({reading,quote:q,samples:engine.samples,market,now,costCents:feeCents*2});
  result.signals.push({at:now,action:reading.action,confidence:reading.confidence,
   planAvailable:plan.available,reason:plan.reason||reading.reason});
  if(plan.available){
   pending={signalAt:now,plan};
  }
 }
 if(position||pending){result.unresolved=true;result.reason='Recorded feed ends before a verified observation of entry/exit completion.';}
 return result;
}

export function replayRecordedModel(rounds,{bankroll=1000,stake=50,feeCents=1,maxRounds=30}={}){
 bankroll=numeric(bankroll,NaN);stake=numeric(stake,NaN);feeCents=numeric(feeCents,NaN);
 maxRounds=numeric(maxRounds,30);
 if(!Number.isFinite(bankroll)||!Number.isFinite(stake)||!Number.isFinite(feeCents)||
   bankroll<=0||bankroll>1000000||stake<=0||stake>100000||feeCents<0||feeCents>20||
   !Number.isInteger(maxRounds)||maxRounds<1||maxRounds>60)return {error:'Invalid replay controls'};
 let balance=bankroll,peak=bankroll,maxDrawdown=0,wins=0,losses=0,unresolved=0,notFilled=0,signalCount=0;
 const results=[],equity=[{at:null,balance}];
 const selected=[...rounds].filter(r=>r?.market?.closeAt<=Date.now()).sort((a,b)=>a.market.closeAt-b.market.closeAt).slice(-maxRounds);
 const covered={snapshots:0,flowReady:0,brtiFresh:0,modelEligible:0,flowMissing:0,brtiMissing:0,staleBook:0};
 for(const round of selected){
  const item=replayRound(round,{balance,stake,feeCents});
  results.push(item);signalCount+=item.signals.length;
  if(item.unresolved)unresolved++;
  if(item.notFilled)notFilled++;
  if(item.trade){
   balance+=item.trade.pnl;
   if(item.trade.pnl>0)wins++;else losses++;
   peak=Math.max(peak,balance);maxDrawdown=Math.max(maxDrawdown,(peak-balance)/peak);
   equity.push({at:item.trade.exitAt,balance});
  }
  for(const k of Object.keys(covered))covered[k]+=item.coverage[k]||0;
 }
 const trades=results.map(r=>r.trade).filter(Boolean);
 return {version:'as-recorded-shared-engine-v1',mode:'PAPER ONLY',
   assumptions:'Same SignalEngine, BRTI veto and suggestPlan as live. Mandatory fresh trade-flow/quote/BRTI context. Entry at next recorded ask and exits at recorded bid if shown size suffices. No order placement or verified fills. Per-side user-specified fee proxy; not Kalshi exact tier schedule.',
   limitations:['As-observed REST snapshots omit order-book changes between samples.','Kalshi rate limits or Render restarts create gaps.','Order queue priority, execution latency and market impact cannot be reconstructed.','No claimed precision or profitability from incomplete rounds.'],
   initialBankroll:bankroll,endingBankroll:balance,pnl:balance-bankroll,
   netReturnPct:100*(balance-bankroll)/bankroll,trades:trades.length,wins,losses,
   winRate:trades.length?wins/trades.length:null,maxDrawdown,signalCount,notFilled,unresolved,
   covered,rounds:results.length,equity,tradeLog:trades,roundResults:results.slice(-30).map(({ticker,closeAt,coverage,signals,reason,notFilled,unresolved,trade})=>({ticker,closeAt,coverage,signals,reason,notFilled,unresolved,traded:!!trade}))};
}
