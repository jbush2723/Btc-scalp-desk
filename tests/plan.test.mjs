import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestPlan,priceGrid,planStatus} from '../plan.js';
const now=100000;
const ranges=[{start:'0',end:'.1',step:'.001'},{start:'.1',end:'.9',step:'.01'},{start:'.9',end:'1',step:'.001'}];
const samples=Array.from({length:16},(_,i)=>({at:now-30000+i*2000,mid:.49+i*.001}));
const base={now,reading:{action:'UP'},quote:{yesBid:.5,yesAsk:.51,yesAskSize:100,noBid:.49,noAsk:.5,noAskSize:50},samples,market:{ticker:'KXBTC15M-A',close_time:new Date(now+300000).toISOString(),price_ranges:ranges}};
test('YES plan uses ask entry and bid exits with at least 2:1 gross reward/risk',()=>{
  const p=suggestPlan(base);assert.equal(p.available,true);assert.equal(p.side,'yes');assert.equal(p.entry,.51);assert.equal(p.stop,.49);assert.equal(p.target,.55);assert.equal(p.netRatio,null);assert.equal(p.ratio,2);
});
test('DOWN plan buys NO and monitors the NO bid, not the YES bid',()=>{
  const p=suggestPlan({...base,reading:{action:'DOWN'}});assert.equal(p.side,'no');assert.equal(p.entry,.5);assert.equal(p.stop,.48);assert.equal(p.target,.54);
  assert.match(planStatus(p,{ticker:p.ticker,quote:{noBid:.54,noAsk:.55,yesBid:.45,yesAsk:.46},fresh:true,seconds:300,action:'DOWN'}),/Take-profit/);
  assert.match(planStatus(p,{ticker:p.ticker,quote:{noBid:.47,noAsk:.48},fresh:true,seconds:300,action:'DOWN'}),/Stop bid/);
});
test('rounds to published ticks and preserves minimum reward ratio at step boundaries',()=>{
  const p=suggestPlan({...base,quote:{yesBid:.089,yesAsk:.09,yesAskSize:10}});assert.equal(p.available,true);assert.equal(p.stop,.07);assert.equal(p.target,.13);
  const grid=priceGrid(ranges,'yes');for(const x of [p.entry,p.stop,p.target])assert.ok(grid.includes(Math.round(x*10000)));
  assert.deepEqual(priceGrid([{start:0,end:1,step:0}],'yes'),[]);assert.deepEqual(priceGrid(null,'yes'),[]);
});
test('rejects WAIT, stale/gapped history, thin books, unsupported ticks, final minute and price ceiling',()=>{
  for(const change of [
    {reading:{action:'WAIT',reason:'Conflict'}},
    {now:now+7000},
    {samples:[samples[0],...samples.slice(6)]},
    {quote:{yesBid:.5,yesAsk:.51,yesAskSize:0}},
    {quote:{yesBid:.5,yesAsk:.54,yesAskSize:1}},
    {quote:{yesBid:.5,yesAsk:.515,yesAskSize:1}},
    {quote:{yesBid:.98,yesAsk:.99,yesAskSize:1}},
    {market:{...base.market,price_ranges:[]}},
    {market:{...base.market,close_time:new Date(now+60000).toISOString()}},
    {samples:samples.map((s,i)=>({...s,mid:i%2?.8:.2}))}
  ])assert.equal(suggestPlan({...base,...change}).available,false,JSON.stringify(change));
});
test('cost allowance computes net figures and rejects poor net reward/risk or invalid costs',()=>{
  const p=suggestPlan({...base,costCents:.1});assert.equal(p.available,true);assert.ok(Math.abs(p.netReward-.039)<1e-9);assert.ok(Math.abs(p.netRisk-.021)<1e-9);
  for(const costCents of [1,5,-1,NaN,101])assert.equal(suggestPlan({...base,costCents}).available,false);
});
test('frozen plan is unchanged through signal reversal, stale data and rollover',()=>{
  const p=Object.freeze(suggestPlan(base)),original=JSON.stringify(p);
  assert.match(planStatus(p,{ticker:p.ticker,quote:base.quote,fresh:true,seconds:300,action:'DOWN'}),/no longer confirmed/);
  assert.match(planStatus(p,{ticker:p.ticker,quote:base.quote,fresh:false}),/stale/);
  assert.match(planStatus(p,{ticker:'KXBTC15M-B',quote:base.quote,fresh:true}),/Previous contract/);
  assert.equal(JSON.stringify(p),original);
});
