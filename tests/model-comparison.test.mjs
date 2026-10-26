import test from 'node:test';
import assert from 'node:assert/strict';
import {compareRecordedStrategies,replayRecordedModel} from '../model-replay.mjs';

function fixture({depth=true,flow=true}={}){
 const now=Date.now()-3600000,ticker='KXBTC15M-TESTCOMPARE';
 const samples=[],trades=[],brtiTicks=[];
 for(let i=0;i<145;i++){
  const at=now+i*5000,mid=.20+Math.min(i,70)*.003;
  const quote={yesBid:mid-.01,yesAsk:mid+.01,noBid:1-mid-.01,noAsk:1-mid+.01,
   yesBidSize:250,yesAskSize:250,noBidSize:250,noAskSize:250};
  const bookLevels={yes:[[mid-.01,400],[mid-.02,200]],
    no:[[1-mid-.01,70],[1-mid-.02,60]]};
  const sample={at,bookAt:at-75,quote,flowReady:flow,marketFresh:true,
   tradeThrough:at-1000,brti:{status:'live',price:100000+i*9,
    sourceTime:at-250,ageMs:250}};
  if(depth)sample.bookLevels=bookLevels;
  samples.push(sample);
  brtiTicks.push({time:at-250,value:100000+i*9});
  for(let j=0;j<7;j++)trades.push({ticker,trade_id:'r'+i+'-'+j,
   created_time:new Date(at-1200).toISOString(),
   seenAt:at-100,count_fp:7,taker_outcome_side:j===0?'no':'yes'});
 }
 return {market:{ticker,openAt:now-1000,closeAt:now+850000,strike:99500,
  price_ranges:[{start:.01,end:1,step:.01}]},samples,trades,brtiTicks};
}

test('comparison returns four strategies with identical round counts and quadratic fees',()=>{
 const r=compareRecordedStrategies([fixture()],{bankroll:1000,stake:50,
  maxRounds:10,maxDailyLoss:100,maxDailyTrades:10,maxExposure:50});
 assert.equal(r.error,undefined);
 assert.deepEqual(r.scenarios.map(s=>s.strategy),['baseline','astro','hybrid','gap']);
 assert.ok(r.scenarios.every(s=>s.feeMode==='quadratic'&&s.rounds===1));
 assert.ok(r.scenarios.every(s=>s.initialBankroll===1000));
 assert.ok(r.scenarios.every(s=>s.trades===0||Number.isFinite(s.pnl)));
});
test('older recordings without depth exclude Astro/hybrid, but not the independent gap model',()=>{
 const r=compareRecordedStrategies([fixture({depth:false})],{bankroll:1000,stake:50,maxRounds:10});
 assert.ok(r.scenarios[0].covered.modelEligible>0);
 assert.equal(r.scenarios[1].covered.modelEligible,0);
 assert.equal(r.scenarios[2].covered.modelEligible,0);
 assert.ok(r.scenarios[3].covered.modelEligible>0);
 assert.equal(r.scenarios[1].trades,0);
 assert.equal(r.scenarios[2].trades,0);
 assert.ok(r.scenarios[1].covered.depthMissing>0);
});
test('incomplete trade-flow windows do not qualify for any of the comparison models',()=>{
 const r=compareRecordedStrategies([fixture({flow:false})],{bankroll:1000,stake:50,maxRounds:10});
 assert.ok(r.scenarios.every(x=>x.covered.modelEligible===0));
 assert.ok(r.scenarios.every(x=>x.trades===0));
});
test('invalid daily loss, exposure and strategy requests fail closed',()=>{
 const rows=[fixture()];
 assert.ok(compareRecordedStrategies(rows,{maxDailyLoss:-2}).error);
 assert.ok(compareRecordedStrategies(rows,{maxExposure:0}).error);
 assert.ok(replayRecordedModel(rows,{strategy:'unknown'}).error);
});
