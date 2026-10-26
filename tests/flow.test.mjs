import test from 'node:test';
import assert from 'node:assert/strict';
import {TradeFlow,selectMarket,normalizeBook,bookQuote,fetchTradeWindow} from '../flow.js';
const now=Date.parse('2026-10-25T18:20:00Z'),ticker='KXBTC15M-A';
const trade=(id,age,side,count='1.25',extra={})=>({trade_id:id,ticker,created_time:new Date(now-age*1000).toISOString(),taker_side:side,count_fp:count,yes_price_dollars:'.8',no_price_dollars:'.2',...extra});
test('fractional taker volumes, duplicate IDs and exact rolling boundaries',()=>{
  const f=new TradeFlow();f.reset(ticker);
  const batch=[trade('a',1,'yes'),trade('b',10,'no','2.50'),trade('c',30,'yes','3'),trade('d',60,'no','5')];
  f.add(batch,now);f.add(batch,now);
  assert.deepEqual(f.totals(10,now),{yes:1.25,no:0,unknown:0,count:1,net:1.25});
  assert.equal(f.totals(30,now).no,2.5);assert.equal(f.totals(60,now).yes,4.25);
  assert.equal(f.totals(60,now+61000).count,0);
});
test('new side field, invalid/unknown sides, block and wrong-market trades',()=>{
  const f=new TradeFlow();f.reset(ticker);
  f.add([trade('a',1,'no','2',{taker_outcome_side:'yes',taker_book_side:'ask'}),trade('b',1,'bid','3'),trade('c',1,'yes','9',{is_block_trade:true}),trade('d',1,'yes','9',{ticker:'OTHER'}),trade('e',1,'yes','bad'),trade('f',1,'yes','-1'),trade('g',1,'yes','1',{created_time:'bad'})],now);
  assert.deepEqual(f.totals(10,now),{yes:2,no:0,unknown:3,count:2,net:2});
});
test('out-of-order events use event time; future trades wait; rollover clears IDs',()=>{
  const f=new TradeFlow();f.reset(ticker);f.add([trade('new',1,'no'),trade('old',50,'yes'),trade('future',-1,'yes')],now);
  assert.equal(f.totals(10,now).count,1);assert.equal(f.totals(10,now+2000).count,2);
  f.reset('KXBTC15M-B');assert.equal(f.totals(60,now).count,0);f.add([trade('old',1,'yes')],now);assert.equal(f.recent(now).length,0);
});
test('market selection ignores future, closed and expired contracts, uses close_time',()=>{
  const m=(ticker,open,close,status='active')=>({ticker,open_time:new Date(now+open).toISOString(),close_time:new Date(now+close).toISOString(),status,expiration_time:'2027-01-01T00:00:00Z'});
  const list=[m('KXBTC15M-FUTURE',1000,10000),m('KXBTC15M-OLD',-10000,0),m('KXBTC15M-CLOSED',-10000,5000,'closed'),m('KXBTC15M-LIVE',-10000,9000)];
  assert.equal(selectMarket(list,now).ticker,'KXBTC15M-LIVE');assert.equal(selectMarket(list,now+20000),null);
});
test('book sorting, dollar fixed points and complementary ask sizes',()=>{
  const b=normalizeBook({orderbook_fp:{yes_dollars:[['.79','20'],['.8','5'],['.9','0']],no_dollars:[['.19','7.5']]}});
  const q=bookQuote(b);assert.equal(q.yesBid,.8);assert.ok(Math.abs(q.yesAsk-.81)<1e-9);assert.equal(q.yesAskSize,7.5);assert.equal(q.noAskSize,5);
  assert.equal(bookQuote(normalizeBook({orderbook_fp:{yes_dollars:[],no_dollars:[]}})).yesAsk,null);
  assert.equal(bookQuote(normalizeBook({t:'book',yes:[[.8,5]],no:[[.19,7]]})).yesBid,.8);
  const fp=normalizeBook({orderbook_fp:{yes_dollars_fp:[['0.61','12.5']],no_dollars_fp:[['0.37','9.0']]}});
  assert.equal(bookQuote(fp).yesBid,.61);
  assert.equal(bookQuote(fp).yesAskSize,9);
});
test('pagination follows cursors and freezes bounds; truncation is explicit',async()=>{
  const calls=[];const get=async path=>{calls.push(new URL(path,'https://test').searchParams);return calls.length===1?{trades:[trade('a',1,'yes')],cursor:'next'}:{trades:[trade('b',2,'no')],cursor:''};};
  const out=await fetchTradeWindow(get,ticker,now);assert.equal(out.trades.length,2);assert.equal(out.complete,true);assert.equal(calls[1].get('cursor'),'next');assert.equal(calls[0].get('max_ts'),calls[1].get('max_ts'));
  const capped=await fetchTradeWindow(async()=>({trades:[],cursor:'same'}),ticker,now,2);assert.equal(capped.complete,false);
});
