import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBrtiContext,applyBrtiVeto} from '../market-context.js';
const time=1800000000000;
const feed=(older,latest=100000)=>({status:'live',price:latest,ageMs:300,sourceTime:time,history:[{time:time-31000,value:older},{time,value:latest}]});
test('official BRTI change and target distance use price units, not Kalshi cents',()=>{
 const x=evaluateBrtiContext(feed(99950),99900);
 assert.equal(x.status,'live');assert.equal(x.direction,'UP');assert.ok(Math.abs(x.changePercent-100*(50/99950))<1e-9);assert.equal(x.distance,100);
});
test('missing or stale BRTI never generates synthetic trend',()=>{
 for(const x of [null,{...feed(99950),ageMs:6000},{...feed(99950),status:'access_denied'}]){
  assert.equal(evaluateBrtiContext(x,99900).direction,'UNKNOWN');
 }
});
test('opposite fresh BRTI momentum vetoes a Kalshi scalp but does not reverse it',()=>{
 const up=evaluateBrtiContext(feed(99950),99900);
 assert.equal(applyBrtiVeto({action:'DOWN',confidence:75,reason:'confirmed'},up).action,'SIT OUT');
 assert.equal(applyBrtiVeto({action:'UP'},up).action,'UP');
 assert.equal(applyBrtiVeto({action:'DOWN'},evaluateBrtiContext(null,99900)).action,'DOWN');
});
test('small BRTI moves and missing 30-second baseline are neutral',()=>{
 const flat=evaluateBrtiContext(feed(99990),99900);
 assert.equal(flat.direction,'FLAT');
 assert.equal(applyBrtiVeto({action:'DOWN'},flat).action,'DOWN');
 const warm=evaluateBrtiContext({...feed(99950),history:[{time:time-10000,value:99950}]},99900);
 assert.equal(warm.direction,'UNKNOWN');
});
