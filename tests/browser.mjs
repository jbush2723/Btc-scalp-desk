import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
try {
 const page=await browser.newPage({serviceWorkers:'block'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const start=Date.now();let failed=false,rolled=false,releaseOld;
 const market=(ticker,close)=>({ticker,status:'active',open_time:new Date(start-10000).toISOString(),close_time:new Date(close).toISOString(),floor_strike:80000,yes_bid_dollars:'.8',yes_ask_dollars:'.81',no_bid_dollars:'.19',no_ask_dollars:'.2'});
 const a=market('KXBTC15M-A',start+1700),b=market('KXBTC15M-B',start+900000);
 await page.route('**/api/**',async route=>{
  const u=new URL(route.request().url());const ticker=u.searchParams.get('ticker');
  if(failed){await route.fulfill({status:503,body:'{}'});return;}
  let body;
  if(u.pathname==='/api/markets')body={markets:Date.now()<start+1700?[a]:[b]};
  else if(u.pathname.endsWith('/orderbook')){
   if(u.pathname.includes('KXBTC15M-A'))await new Promise(r=>{releaseOld=r;setTimeout(r,2200)});
   body={orderbook_fp:{yes_dollars:[[u.pathname.includes('KXBTC15M-A')?'.8':'.6','10']],no_dollars:[['.39','20']]}};
  }else if(u.pathname==='/api/markets/trades')body={trades:[{trade_id:'same',ticker,count_fp:'2.50',created_time:new Date().toISOString(),taker_side:'yes',yes_price_dollars:'.6',no_price_dollars:'.4'},{trade_id:'same',ticker,count_fp:'2.50',created_time:new Date().toISOString(),taker_side:'yes',yes_price_dollars:'.6',no_price_dollars:'.4'}],cursor:''};
  else body={market:u.pathname.endsWith('KXBTC15M-A')?a:b};
  await route.fulfill({json:body});
 });
 await page.goto('http://127.0.0.1:8787/');
 await page.waitForFunction(()=>document.getElementById('liveTicker').textContent==='KXBTC15M-B'&&document.getElementById('yesBid').textContent==='60.0¢');
 assert.equal(await page.locator('#flowRows tr').first().locator('td').nth(1).textContent(),'2.5','Duplicate trade counted once');
 await page.locator('#refreshLive').click();await page.waitForTimeout(100);assert.equal(await page.locator('#flowRows tr').first().locator('td').nth(1).textContent(),'2.5','Reconnect replay counted once');
 failed=true;await page.locator('#refreshLive').click();await page.waitForFunction(()=>document.getElementById('liveStatus').textContent.includes('503'));
 await page.clock.setFixedTime(Date.now()+20000);await page.waitForTimeout(600);
 assert.equal(await page.locator('#yesBid').textContent(),'—');assert.equal(await page.locator('#flowRows tr').first().locator('td').nth(1).textContent(),'—');
 assert.match(await page.locator('#bookStatus').textContent(),/stale/);
 await page.locator('#brti').fill('80010');await page.locator('#target').fill('80000');assert.match(await page.locator('#distance').textContent(),/10.00/);await page.locator('#brti').fill('');assert.equal(await page.locator('#distance').textContent(),'—');
 assert.deepEqual(errors,[]);console.log('PASS: delayed previous-market response, rollover, duplicate/replayed trades, stale-feed hiding, manual input reset; no browser errors.');
}finally{await browser.close();}
