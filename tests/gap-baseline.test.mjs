import test from 'node:test';
import assert from 'node:assert/strict';
import {normalCdf,observedVolatility,gapProbability,gapConfidenceGate} from '../gap-baseline.js';

const now=Date.now();
function fixture(){
 const history=[];
 for(let i=0;i<=60;i++){
  const t=now-300000+i*5000;
  history.push({time:t,value:100000+32*Math.sin(i*.69)+i*.3});
 }
 return {status:'live',price:history.at(-1).value,sourceTime:now,
   ageMs:200,history};
}
test('normal CDF and symmetrical tails remain bounded',()=>{
 assert.ok(Math.abs(normalCdf(0)-.5)<1e-6);
 assert.ok(Math.abs(normalCdf(1)+normalCdf(-1)-1)<1e-6);
});
test('volatility requires continuous independent observed history',()=>{
 const x=fixture();
 assert.ok(observedVolatility(x.history,now)?.sigma1s>0);
 const gap=x.history.filter(p=>p.time<now-60000||p.time>now-40000);
 assert.equal(observedVolatility(gap,now),null);
 assert.equal(observedVolatility(x.history.slice(-20),now),null);
});
test('M0 refuses stale BRTI and last-minute unmodeled settlement',()=>{
 const x=fixture();
 assert.equal(gapProbability({snapshot:{...x,ageMs:7000},strike:100000,closeAt:now+300000,now}).ready,false);
 assert.equal(gapProbability({snapshot:x,strike:100000,closeAt:now+30000,now}).ready,false);
});
test('M0 uses zero drift and produces sensible gap-conditioned probabilities',()=>{
 const x=fixture(),base=gapProbability({snapshot:x,strike:x.price,closeAt:now+540000,now});
 assert.equal(base.ready,true);
 assert.ok(Math.abs(base.pYes-.5)<.01);
 const below=gapProbability({snapshot:x,strike:x.price-400,closeAt:now+540000,now});
 const above=gapProbability({snapshot:x,strike:x.price+400,closeAt:now+540000,now});
 assert.ok(below.pYes>base.pYes);
 assert.ok(above.pYes<base.pYes);
});
test('confidence plus spread and quadratic fee gates fail closed',()=>{
 const x=fixture();
 const m=gapProbability({snapshot:x,strike:x.price-600,closeAt:now+420000,now});
 const quote={yesBid:.78,yesAsk:.80,yesAskSize:100,noBid:.20,noAsk:.22,noAskSize:100};
 assert.equal(gapConfidenceGate(m,quote).action,'UP');
 assert.equal(gapConfidenceGate(m,{...quote,yesAsk:.84}).action,'WAIT');
 assert.equal(gapConfidenceGate(m,{...quote,yesAskSize:0}).action,'WAIT');
 assert.equal(gapConfidenceGate(m,{...quote,yesBid:.78,yesAsk:.99}).action,'WAIT');
 assert.equal(gapConfidenceGate(m,{...quote,yesAsk:.98,yesBid:.96}).action,'WAIT');
});
