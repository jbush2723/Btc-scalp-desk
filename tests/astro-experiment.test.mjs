import test from 'node:test';
import assert from 'node:assert/strict';
import {weightedBookSkew,quadraticFee,indexMomentum,astroExperiment,feeAwareScalpGuard} from '../astro-experiment.js';

const now=Date.now();
const book={
 yes:[['invalid',4],[.19,190],[.18,210],[.17,20]],
 no:[[.78,35],[.77,25],[.76,5]]
};
const quote={yesBid:.19,yesAsk:.22,noBid:.78,noAsk:.81,
 yesBidSize:90,yesAskSize:35,noBidSize:35,noAskSize:90};
const ticks=Array.from({length:65},(_,i)=>({time:now-320000+i*5000,value:100000+i*10}));

test('weighted order-book skew uses price-weighted depths rather than top quote alone',()=>{
 const r=weightedBookSkew(book);
 assert.ok(r);
 assert.ok(r.skew>0);
 assert.equal(r.yesDepth,420);
 assert.equal(r.noDepth,65);
 assert.equal(weightedBookSkew({yes:book.yes,no:[]}),null);
});
test('fee estimate uses per-order quadratic rounding (not per-contract ceiling)',()=>{
 assert.equal(quadraticFee(10,.5),.18);
 assert.equal(quadraticFee(100,.5),1.75);
 assert.equal(quadraticFee(1,.5),.02);
 assert.equal(quadraticFee(0,.5),null);
});
test('index momentum requires 5m of observed as-of BRTI data',()=>{
 const valid=indexMomentum(ticks,now);
 assert.ok(valid);
 assert.ok(valid.rawChangePct>0);
 assert.equal(indexMomentum(ticks.slice(-8),now),null);
 assert.equal(indexMomentum(ticks,now+30000),null);
});
test('experimental signal never trades without real depth or sufficient BRTI',()=>{
 const ready=astroExperiment({book,quote,brtiTicks:ticks,now,closeAt:now+450000});
 assert.ok(ready.ready);
 assert.equal(ready.action,'UP');
 assert.equal(astroExperiment({book:null,quote,brtiTicks:ticks,now,closeAt:now+450000}).action,'WAIT');
 assert.equal(astroExperiment({book,quote,brtiTicks:[],now,closeAt:now+450000}).action,'WAIT');
 assert.equal(astroExperiment({book,quote,brtiTicks:ticks,now,closeAt:now+59000}).action,'WAIT');
});
test('tight scalp spread overrides AstroTick broad default even when index is strong',()=>{
 const wide={...quote,yesAsk:.26,noBid:.74};
 const r=astroExperiment({book,quote:wide,brtiTicks:ticks,now,closeAt:now+450000});
 assert.equal(r.action,'WAIT');assert.match(r.reason,/3¢/);
});
test('fee-aware entry sizing stays within $50 and estimates both exit sides',()=>{
 const plan={available:true,side:'yes',entry:.3,stop:.20,target:.70};
 const q={yesAsk:.3,yesBid:.29,yesAskSize:300};
 const result=feeAwareScalpGuard(plan,q,{stake:50,balance:1000,maxExposure:50});
 assert.equal(result.allowed,true);
 assert.ok(result.qty*.3+result.openFee<=50+1e-9);
 assert.ok(result.netTarget>0);assert.ok(result.netStopRisk>0);
 assert.equal(feeAwareScalpGuard(plan,{...q,yesAsk:.31},{stake:50,balance:1000,maxExposure:50}).allowed,false);
});
