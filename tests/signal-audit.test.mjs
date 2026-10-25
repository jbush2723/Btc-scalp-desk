import test from 'node:test';
import assert from 'node:assert/strict';
import {SignalAudit} from '../signal-audit.js';

const entries=new Map();
globalThis.localStorage={
 getItem:key=>entries.get(key)||null,
 setItem:(key,value)=>entries.set(key,value),
 removeItem:key=>entries.delete(key)
};
const ticker='KXBTC15M-TEST';
const quote=(bid=.5,ask=.52)=>({yesBid:bid,yesAsk:ask,noBid:1-ask,noAsk:1-bid});
function newAudit(time,closeAt=time+900000){
 entries.clear();
 const audit=new SignalAudit();
 audit.observe({ticker,action:'UP',score:90,quote:quote(.49,.5),now:time,
  quoteAt:time,fresh:true,closeAt});
 return audit;
}
function tick(audit,time,closeAt,ask=.52,bid=.51,current=ticker){
 return audit.observe({ticker:current,action:'WAIT',score:null,quote:quote(bid,ask),
  now:time,quoteAt:time,fresh:true,closeAt});
}
const start=Date.now()-1200000;

test('7-minute audit completes at exact horizon when valid book observations exist',()=>{
 const closeAt=start+900000,audit=newAudit(start,closeAt);
 let result;
 for(let t=start+5000;t<=start+420000;t+=5000)result=tick(audit,t,closeAt);
 assert.equal(result.complete,1);
 assert.equal(result.shortened,0);
 assert.equal(result.rows[0].status,'complete');
 assert.equal(result.rows[0].exitReason,'seven_minute_limit');
 assert.equal(result.rows[0].checkpoints[420],result.rows[0].finalGross);
});
test('pre-close cutoff records separate shorter exit; excludes 7m hit denominator',()=>{
 const closeAt=start+240000,audit=newAudit(start,closeAt);
 let result;
 for(let t=start+5000;t<=start+180000;t+=5000)result=tick(audit,t,closeAt);
 assert.equal(result.complete,0);
 assert.equal(result.shortened,1);
 assert.equal(result.rows[0].status,'cutoff_exit');
 assert.equal(result.rows[0].exitReason,'one_minute_before_close');
 assert.equal(result.rows[0].plannedExit,start+180000);
});
test('normal ticker-less rollover is not marked market_changed',()=>{
 const closeAt=start+180000,audit=newAudit(start,closeAt);
 const result=audit.observe({ticker:null,action:'WAIT',quote:null,fresh:false,now:start+5000,closeAt:null});
 assert.equal(result.rows[0].status,'tracking');
});
test('unexpected ticker change before the close buffer is distinguished',()=>{
 const closeAt=start+900000,audit=newAudit(start,closeAt);
 const result=audit.observe({ticker:'KXBTC15M-OTHER',now:start+5000,quoteAt:0,fresh:false,closeAt:null});
 assert.equal(result.rows[0].status,'market_changed');
});
test('quote gaps are incomplete and never counted as winners',()=>{
 const closeAt=start+900000,audit=newAudit(start,closeAt);
 const result=audit.observe({ticker,now:start+25000,quote:null,fresh:false,quoteAt:0,closeAt});
 assert.equal(result.rows[0].status,'data_gap');
 assert.equal(result.complete,0);
});
test('late entries inside final minute are rejected from audit',()=>{
 entries.clear();const audit=new SignalAudit();
 const closeAt=start+45000;
 const result=audit.observe({ticker,action:'UP',score:100,quote:quote(.49,.50),
  now:start,quoteAt:start,fresh:true,closeAt});
 assert.equal(result.rows.length,0);
});
