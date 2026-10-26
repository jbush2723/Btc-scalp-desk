// Conservative replay of the EXACT live SignalEngine, BRTI veto and suggestPlan.
// Uses ONLY server-as-observed timestamps. No historical candles are interpolated.
// Quote fills are still hypotheses: book updates do not prove execution queue priority.
import {SignalEngine} from './signal.js';
import {TradeFlow,WINDOWS} from './flow.js';
import {evaluateBrtiContext,applyBrtiVeto} from './market-context.js';
import {suggestPlan} from './plan.js';
import {astroExperiment,weightedBookSkew,indexMomentum,quadraticFee,feeAwareScalpGuard} from './astro-experiment.js';

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

function replayRound(round,{balance,stake,feeCents,strategy='baseline',feeMode='fixed',maxExposure=stake,feeRate=.07,minNetRatio=1.5}){
 const ticker=round.market?.ticker,closeAt=round.market?.closeAt,openedAt=round.market?.openAt;
 const samples=(round.samples||[]).slice().sort((a,b)=>a.at-b.at);
 const trades=(round.trades||[]).slice().sort((a,b)=>a.seenAt-b.seenAt);
 const coverage={snapshots:samples.length,flowReady:0,freshBook:0,brtiFresh:0,modelEligible:0,
  brtiMissing:0,flowMissing:0,staleBook:0,depthReady:0,depthMissing:0,feeBlocked:0,skewBlocked:0};
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
  const depth=weightedBookSkew(sample.bookLevels);
  if(depth)coverage.depthReady++;else coverage.depthMissing++;
  if(bookFresh)coverage.freshBook++;else coverage.staleBook++;
  if(flowFresh)coverage.flowReady++;else coverage.flowMissing++;
  if(feed&&brti?.changePercent!==null)coverage.brtiFresh++;else coverage.brtiMissing++;
  if(!bookFresh){if(pending)pending=null;continue;}
  if(position&&now-position.lastAt>8000){
   result.unresolved=true;result.reason='Gap longer than 8 seconds while a position was open; exit price and timing cannot be reconstructed.';
   position=null;break;
  }
  engine.record(q,sample.bookAt);
  // Mark an incomplete trade window as unavailable instead of treating its
  // observed partial volumes as evidence for a directional signal.
  const ready=bookFresh&&flowFresh&&sample.marketFresh;
  const base=engine.evaluate({now,ready,seconds:(closeAt-now)/1000,totals:WINDOWS.map(w=>flow.totals(w,now))});
  const reading=applyBrtiVeto(base,brti);
  const strict=ready&&feed&&brti.changePercent!==null;
  // Astro's full 5-minute index context is additionally mandatory; counting
  // a missing history window as "eligible" would inflate the comparison.
  const fiveMinuteReady=strategy==='astro'&&feed?
   indexMomentum(round.brtiTicks.filter(t=>t.time<=feed.sourceTime),feed.sourceTime)!==null:false;
  if(strict&&(strategy==='baseline'||Boolean(depth)&&(strategy!=='astro'||fiveMinuteReady)))
   coverage.modelEligible++;
  if(position){
   const bid=q[position.side+'Bid'],size=q[position.side+'BidSize'];
   const reason=bid<=position.stop?'STOP':bid>=position.target?'TARGET':
    now-position.entryAt>=420000?'7-MINUTE TIME LIMIT':closeAt-now<=60000?'FINAL MINUTE':null;
   if(reason){
    if(!Number.isFinite(bid)||!Number.isFinite(size)||size<position.qty){
     result.unresolved=true;result.reason='Exit liquidity was not observed at the decision time; cannot assert a complete fill.';
    }else{
     const exitFee=feeMode==='quadratic'?quadraticFee(position.qty,bid,feeRate):feeCents/100*position.qty;
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
   position.lastAt=now;
   continue;
  }
  if(pending){
   const item=pending;pending=null;
   if(now-item.signalAt>8000||now<=item.signalAt){result.notFilled=true;result.reason='No next quote within 8 seconds of the signal.';attempted=true;continue;}
   const ask=q[item.plan.side+'Ask'],available=q[item.plan.side+'AskSize'],bid=q[item.plan.side+'Bid'];
   const fee=feeCents/100;
   let qty,entryFee;
   if(feeMode==='quadratic'){
    const check=feeAwareScalpGuard(item.plan,q,{stake,balance,feeRate,maxExposure,minNetRatio});
    if(!check.allowed){
     coverage.feeBlocked++;result.notFilled=true;result.reason='Common fee/risk gate rejected simulated entry: '+check.reason;
     attempted=true;continue;
    }
    qty=check.qty;entryFee=check.openFee;
   }else{
    qty=Math.floor(Math.min(available,stake/(ask+fee),balance/(ask+fee)));
    entryFee=fee*qty;
   }
   if(!Number.isFinite(ask)||!Number.isFinite(available)||!Number.isFinite(bid)||ask<=0||
      ask>item.plan.entry+1e-8||qty<1||ask-bid>.03000001){
    result.notFilled=true;result.reason='Next observed ask exceeded the entry limit, available size, or spread restriction.';attempted=true;continue;
   }
   attempted=true;
   position={signalAt:item.signalAt,entryAt:now,lastAt:now,entry:ask,side:item.plan.side,qty,
    entryFee,stop:item.plan.stop,target:item.plan.target};
   result.reason='Hypothetical entry; awaiting observed exit bid.';
   continue;
  }
  // All strategies use identical data-coverage windows. AstroTick-inspired
  // branches additionally require recorded top-ten depth, never inferred depth.
  if(!strict||attempted)continue;
  let experimental=null,proposal=reading;
  if(strategy==='astro'){
   if(!depth)continue;
   const ticks=round.brtiTicks.filter(x=>x.time<=feed.sourceTime);
   experimental=astroExperiment({book:sample.bookLevels,quote:q,brtiTicks:ticks,
    now:feed.sourceTime,closeAt,feeRate});
   proposal={action:experimental.action,confidence:experimental.score===null?null:Math.round(Math.abs(experimental.score)*100),reason:experimental.reason};
  }else if(strategy==='hybrid'){
   if(!depth||!['UP','DOWN'].includes(reading.action))continue;
   if(Math.abs(depth.skew)<.10||
     (reading.action==='UP'&&depth.skew<=0)||(reading.action==='DOWN'&&depth.skew>=0)){
    coverage.skewBlocked++;continue;
   }
  }
  if(!['UP','DOWN'].includes(proposal.action))continue;
  // The live default plan is evaluated WITHOUT an assumed fee allowance.
  // Replay fees are deducted from hypothetical P/L separately; otherwise the
  // entry rules would differ from what the user sees on the live dashboard.
  const plan=suggestPlan({reading:proposal,quote:q,samples:engine.samples,market,now,costCents:null});
  result.signals.push({at:now,action:proposal.action,confidence:proposal.confidence,
   skew:depth?.skew??null,heuristicPYes:experimental?.heuristicPYes??null,
   planAvailable:plan.available,reason:plan.reason||proposal.reason});
  if(plan.available){
   pending={signalAt:now,plan};
  }
 }
 if(position||pending){result.unresolved=true;result.reason='Recorded feed ends before a verified observation of entry/exit completion.';}
 return result;
}

export function replayRecordedModel(rounds,{
 bankroll=1000,stake=50,feeCents=1,maxRounds=30,strategy='baseline',feeMode='fixed',
 feeRate=.07,maxDailyLoss=100,maxDailyTrades=10,maxExposure=50,minNetRatio=1.5
}={}){
 bankroll=numeric(bankroll,NaN);stake=numeric(stake,NaN);feeCents=numeric(feeCents,NaN);
 maxRounds=numeric(maxRounds,NaN);feeRate=numeric(feeRate,NaN);
 maxDailyLoss=numeric(maxDailyLoss,NaN);maxDailyTrades=numeric(maxDailyTrades,NaN);
 maxExposure=numeric(maxExposure,NaN);minNetRatio=numeric(minNetRatio,NaN);
 if(!Number.isFinite(bankroll)||!Number.isFinite(stake)||!Number.isFinite(feeCents)||
   bankroll<=0||bankroll>1000000||stake<=0||stake>100000||feeCents<0||feeCents>20||
   !Number.isInteger(maxRounds)||maxRounds<1||maxRounds>60||
   !['baseline','astro','hybrid'].includes(strategy)||!['quadratic','fixed'].includes(feeMode)||
   !Number.isFinite(feeRate)||feeRate<0||feeRate>1||
   !Number.isFinite(maxDailyLoss)||maxDailyLoss<0||maxDailyLoss>1000000||
   !Number.isInteger(maxDailyTrades)||maxDailyTrades<1||maxDailyTrades>500||
   !Number.isFinite(maxExposure)||maxExposure<=0||maxExposure>1000000||
   !Number.isFinite(minNetRatio)||minNetRatio<0||minNetRatio>20)
  return {error:'Invalid replay controls'};
 let balance=bankroll,peak=bankroll,maxDrawdown=0,wins=0,losses=0,unresolved=0,notFilled=0,signalCount=0,riskBlocked=0;
 const results=[],equity=[{at:null,balance}],daily=new Map();
 const selected=[...rounds].filter(r=>r?.market?.closeAt<=Date.now())
  .sort((a,b)=>a.market.closeAt-b.market.closeAt).slice(-maxRounds);
 const covered={snapshots:0,flowReady:0,brtiFresh:0,modelEligible:0,flowMissing:0,
  brtiMissing:0,staleBook:0,depthReady:0,depthMissing:0,feeBlocked:0,skewBlocked:0};
 for(const round of selected){
  const day=new Date(round.market.closeAt).toISOString().slice(0,10);
  const prior=daily.get(day)||{trades:0,losses:0};
  if(prior.trades>=maxDailyTrades||prior.losses>=maxDailyLoss||balance<=0){
   riskBlocked++;
   results.push({ticker:round.market.ticker,closeAt:round.market.closeAt,
    coverage:Object.fromEntries(Object.keys(covered).map(key=>[key,0])),
    signals:[],trade:null,notFilled:false,unresolved:false,
    reason:'Risk gate blocked new entry: daily loss/trades threshold or depleted simulated balance.'});
   continue;
  }
  const item=replayRound(round,{balance,stake:Math.min(stake,maxExposure),feeCents,
    strategy,feeMode,maxExposure,feeRate,minNetRatio});
  results.push(item);signalCount+=item.signals.length;
  if(item.unresolved)unresolved++;
  if(item.notFilled)notFilled++;
  if(item.trade){
   balance+=item.trade.pnl;
   if(item.trade.pnl>0)wins++;else losses++;
   prior.trades++;
   if(item.trade.pnl<0)prior.losses-=item.trade.pnl;
   daily.set(day,prior);
   peak=Math.max(peak,balance);maxDrawdown=Math.max(maxDrawdown,(peak-balance)/peak);
   equity.push({at:item.trade.exitAt,balance});
  }
  for(const k of Object.keys(covered))covered[k]+=item.coverage[k]||0;
 }
 const trades=results.map(r=>r.trade).filter(Boolean);
 return {version:'as-recorded-model-comparison-v2',mode:'PAPER ONLY',strategy,feeMode,feeRate,
   risk:{maxDailyLoss,maxDailyTrades,maxExposure,minNetRatio,riskBlocked},
   assumptions:strategy==='baseline'?
     'Existing SignalEngine, BRTI veto and suggestPlan. Entries/exits hypothesized using the next observed ask and subsequent bid. Comparisons use common quadratic fees and risk gates; the live signal rules remain unchanged.':
     strategy==='astro'?
     'EXPERIMENT: 60% BRTI momentum + 40% weighted ten-level orderbook imbalance, a heuristic probability edge and entry-fee filters. Not a calibrated probability or trained model.':
     'EXPERIMENT: Existing live SignalEngine + aligned weighted orderbook skew, BRTI veto and common quadratic fee/risk gate.',
   limitations:['As-observed snapshots miss interim order-book changes and fills.',
    'Older recordings without observed ten-level depth are ineligible for Astro/hybrid.',
    'Kalshi fee model is an estimate; verify the series fee schedule before any real order.',
    'Unresolved exposure is excluded from ending bankroll, so P/L may be incomplete.',
    'No model is a tested trading advantage until out-of-sample net results exist.'],
   initialBankroll:bankroll,endingBankroll:balance,pnl:balance-bankroll,
   netReturnPct:100*(balance-bankroll)/bankroll,trades:trades.length,wins,losses,
   winRate:trades.length?wins/trades.length:null,maxDrawdown,signalCount,notFilled,unresolved,
   covered,rounds:results.length,equity,tradeLog:trades,
   roundResults:results.slice(-30).map(({ticker,closeAt,coverage,signals,reason,notFilled,unresolved,trade})=>
    ({ticker,closeAt,coverage,signals,reason,notFilled,unresolved,traded:!!trade}))};
}

export function compareRecordedStrategies(rounds,options={}){
 const params={...options,feeMode:'quadratic'};
 const baseline=replayRecordedModel(rounds,{...params,strategy:'baseline'});
 const astro=replayRecordedModel(rounds,{...params,strategy:'astro'});
 const hybrid=replayRecordedModel(rounds,{...params,strategy:'hybrid'});
 if(baseline.error||astro.error||hybrid.error)
  return {error:baseline.error||astro.error||hybrid.error};
 return {version:'astro-hybrid-paper-comparison-v1',mode:'PAPER ONLY',
  dataNote:'Exactly the same completed recorded contracts, common ask-to-bid fill assumptions, Kalshi quadratic taker-fee estimates, spread limits, stake and daily risk gates. Models have different eligibility; compare coverage before performance. Experimental probabilities are NOT calibrated.',
  scenarios:[
   {id:'baseline',label:'Current model + common fee/risk rules',...baseline},
   {id:'astro',label:'AstroTick-inspired (experimental)',...astro},
   {id:'hybrid',label:'Current model + aligned book skew (experimental)',...hybrid}
  ]};
}
