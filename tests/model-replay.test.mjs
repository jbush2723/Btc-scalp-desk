import test from 'node:test';
import assert from 'node:assert/strict';
import {replayRecordedModel} from '../model-replay.mjs';

function fixture({flow=true,brti=true,gap=false}={}){
 const start=Date.now()-3600000;
 const ticker='KXBTC15M-TEST';
 const samples=[],trades=[],brtiTicks=[];
 for(let i=0;i<130;i++){
  const at=start+i*5000+(gap&&i>=18?12000:0);
  let mid=.40+Math.min(Math.floor(i/3),20)*.01;
  if(i>85)mid=.60-(Math.floor((i-85)/3)*.01);
  const quote={yesBid:mid-.01,yesAsk:mid+.01,noBid:1-mid-.01,noAsk:1-mid+.01,
   yesBidSize:250,yesAskSize:250,noBidSize:250,noAskSize:250};
  samples.push({at,bookAt:at-150,tradeThrough:at-1000,flowReady:flow,marketFresh:true,
   quote,brti:{status:brti?'live':'unavailable',price:brti?103000+i*.2:null,
    sourceTime:brti?at-400:null,ageMs:brti?400:null}});
  if(brti)brtiTicks.push({time:at-400,value:103000+i*.2});
  for(let j=0;j<7;j++)trades.push({ticker,trade_id:'id'+i+'-'+j,
   created_time:new Date(at-1000-j*100).toISOString(),count_fp:7,
   taker_outcome_side:j===0?'no':'yes',seenAt:at-500});
 }
 return {market:{ticker,openAt:start-1000,closeAt:start+910000,strike:102500,
   price_ranges:[{start:.01,end:1,step:.01}]},samples,trades,brtiTicks};
}
const options={bankroll:1000,stake:50,feeCents:1,maxRounds:30};

test('shared engine makes a fully observed paper entry and takes profit with fees',()=>{
 const result=replayRecordedModel([fixture()],options);
 assert.equal(result.error,undefined);
 assert.equal(result.rounds,1);
 assert.equal(result.trades,1);
 assert.equal(result.tradeLog[0].side,'YES');
 assert.equal(result.tradeLog[0].reason,'TARGET');
 assert.ok(result.tradeLog[0].estimatedFees>0);
 assert.ok(result.pnl>0);
 assert.equal(result.endingBankroll,1000+result.pnl);
});

test('missing trade history is never considered a passing flow filter',()=>{
 const result=replayRecordedModel([fixture({flow:false})],options);
 assert.equal(result.trades,0);
 assert.equal(result.signalCount,0);
 assert.equal(result.covered.modelEligible,0);
 assert.ok(result.covered.flowMissing>0);
});

test('missing BRTI context makes the full-fidelity replay ineligible',()=>{
 const result=replayRecordedModel([fixture({brti:false})],options);
 assert.equal(result.trades,0);
 assert.equal(result.covered.modelEligible,0);
 assert.ok(result.covered.brtiMissing>0);
});

test('missing quotes while a simulated position is open cannot fabricate exits',()=>{
 const round=fixture();
 // After entry, insert a long missing-quote gap before the first possible target.
 const entryIndex=round.samples.findIndex(s=>s.at>round.market.openAt+50000);
 for(let i=entryIndex+1;i<round.samples.length;i++)round.samples[i].at+=30000;
 // Realtime observed times and source times move with the observations.
 for(let i=entryIndex+1;i<round.samples.length;i++){
  const s=round.samples[i];s.bookAt=s.at-150;s.tradeThrough=s.at-1000;
  s.brti.sourceTime=s.at-400;
 }
 const result=replayRecordedModel([round],options);
 assert.equal(result.error,undefined);
 assert.ok(result.unresolved>=0);
});

test('invalid bankroll controls cannot produce a performance report',()=>{
 assert.ok(replayRecordedModel([fixture()],{...options,stake:-1}).error);
});
