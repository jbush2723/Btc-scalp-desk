import test from 'node:test';
import assert from 'node:assert/strict';
import {SignalEngine} from '../signal.js';
const start=100000;
const totals=(yes=70,no=30)=>[10,30,60].map(()=>({yes,no,unknown:0,count:10}));
const quote=mid=>({yesBid:mid-.005,yesAsk:mid+.005});
function warmed(direction=1){const s=new SignalEngine();for(let i=0;i<=30;i+=2)s.record(quote(.5+direction*i*.001),start+i*1000);return s;}
const evaluate=(s,extra={})=>s.evaluate({now:s.samples.at(-1)?.at||start,ready:true,seconds:300,totals:totals(),...extra});
function confirmed(direction=1){const s=warmed(direction);evaluate(s,{totals:direction>0?totals():totals(30,70)});for(const i of [32,34]){s.record(quote(.5+direction*i*.001),start+i*1000);evaluate(s,{totals:direction>0?totals():totals(30,70)});}return s;}
test('UP and DOWN need aligned flow and three distinct confirmed snapshots',()=>{
  const s=warmed();assert.equal(evaluate(s).action,'WAIT');assert.equal(evaluate(s).trend,'UP');
  for(let i=0;i<10;i++)assert.equal(evaluate(s).action,'WAIT','Repeated rendering must not confirm');
  assert.equal(evaluate(confirmed()).action,'UP');
  const down=evaluate(confirmed(-1),{totals:totals(30,70)});assert.equal(down.action,'DOWN');assert.equal(down.trend,'DOWN');
});
test('SIT OUT for unsuitable conditions; WAIT for unreliable data',()=>{
  const s=confirmed();assert.equal(evaluate(s,{totals:totals(30,70)}).action,'SIT OUT');
  assert.equal(evaluate(confirmed(),{seconds:60}).action,'SIT OUT');
  assert.equal(evaluate(confirmed(),{totals:totals(7,3)}).action,'SIT OUT');
  assert.equal(evaluate(confirmed(),{totals:totals().map(x=>({...x,count:4}))}).action,'SIT OUT');
  assert.equal(evaluate(confirmed(),{totals:totals().map(x=>({...x,unknown:20}))}).action,'WAIT');
  const wide=confirmed();wide.record({yesBid:.51,yesAsk:.56},start+36000);assert.match(evaluate(wide).reason,/Spread/);
});
test('stale, incomplete and invalid quotes cannot retain a direction; reset requires warmup',()=>{
  assert.equal(evaluate(confirmed(),{ready:false}).trend,'UNAVAILABLE');
  assert.equal(evaluate(confirmed(),{now:start+50000}).action,'WAIT');
  const s=confirmed();s.record({yesBid:.8,yesAsk:.7},start+36000);assert.equal(evaluate(s).action,'WAIT');assert.equal(s.samples.length,0);
  s.record(quote(.6),start+40000);assert.equal(evaluate(s).trend,'WARMING UP');s.reset();assert.equal(evaluate(s).action,'WAIT');
});
test('flat prices stay sideways, and a gap resets trend history',()=>{
  const s=new SignalEngine();for(let i=0;i<=30;i+=2)s.record(quote(.7),start+i*1000);
  const flat=evaluate(s);assert.equal(flat.trend,'SIDEWAYS');assert.equal(flat.action,'SIT OUT');assert.match(flat.lean,/UP/);
  s.record(quote(.72),start+40000);assert.equal(evaluate(s).trend,'WARMING UP');
});

test('confidence reflects directional agreement, and is absent for unusable data',()=>{
 const strong=evaluate(confirmed());
 const conflict=evaluate(confirmed(),{totals:totals(30,70)});
 assert.ok(strong.confidence>=60&&strong.confidence<=100);
 assert.ok(conflict.confidence<strong.confidence);
 assert.equal(conflict.action,'SIT OUT');
 assert.equal(evaluate(warmed()).action,'WAIT');
 assert.equal(evaluate(confirmed(),{ready:false}).confidence,null);
 assert.equal(evaluate(confirmed(),{totals:totals(7,3)}).confidence,null);
 assert.equal(evaluate(confirmed(),{totals:totals().map(t=>({...t,unknown:30}))}).confidence,null);
 const down=evaluate(confirmed(-1),{totals:totals(30,70)});
 assert.equal(down.confidence,strong.confidence);
});
