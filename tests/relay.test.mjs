import test from 'node:test';
import assert from 'node:assert/strict';
import {upstreamPath,createRelay} from '../relay.mjs';
test('relay only accepts documented BTC read routes',()=>{
  assert.match(upstreamPath('/api/markets?series_ticker=KXBTC15M&status=open&limit=100'),/^\/markets\?/);
  assert.equal(upstreamPath('/api/markets/KXBTC15M-A/orderbook?depth=10'),'/markets/KXBTC15M-A/orderbook?depth=10');
  for(const path of ['/api/portfolio/balance','/api/markets?series_ticker=OTHER&status=open','/api/markets/trades?ticker=OTHER','/api/markets/KXBTC15M-A?url=https://evil.test','/api/markets/KXBTC15M-A/orderbook?depth=-1','/api/markets/trades?ticker=KXBTC15M-A&ticker=OTHER'])assert.throws(()=>upstreamPath(path));
});
test('concurrent requests coalesce, successful responses cache briefly',async()=>{
  let count=0;const relay=createRelay(async()=>{count++;await new Promise(r=>setTimeout(r,5));return new Response('{"markets":[]}');});
  const r=await Promise.all([relay('/markets'),relay('/markets')]);assert.equal(count,1);assert.equal(r[0].status,200);await relay('/markets');assert.equal(count,1);
});
test('denials are surfaced; rate limits apply across requests',async()=>{
  const denied=createRelay(async()=>new Response('denied',{status:403}));assert.equal((await denied('/markets')).status,403);
  let count=0;const limited=createRelay(async()=>{count++;return new Response('',{status:429,headers:{'Retry-After':'10'}});});
  assert.equal((await limited('/a')).status,429);assert.equal((await limited('/b')).status,429);assert.equal(count,1);
});
