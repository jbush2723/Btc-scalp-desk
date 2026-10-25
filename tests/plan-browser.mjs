import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
try {
 const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const start=Date.now();let stage=0,forcedBid=null,roll=false;
 await page.clock.install({time:start});
 const ranges=[{start:'0',end:'.1',step:'.001'},{start:'.1',end:'.9',step:'.01'},{start:'.9',end:'1',step:'.001'}];
 const ticker=()=>roll?'KXBTC15M-B':'KXBTC15M-A';
 const market=()=>({ticker:ticker(),status:'active',open_time:new Date(start+(roll?600000:-1000)).toISOString(),close_time:new Date(start+(roll?1200000:600000)).toISOString(),price_ranges:ranges});
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let body;
  const bid=forcedBid??(.4+Math.floor(stage/3)*.01),ask=bid+.01;
  if(url.pathname==='/api/markets')body={markets:[market()]};
  else if(url.pathname.endsWith('/orderbook'))body={orderbook_fp:{yes_dollars:[[bid.toFixed(3),'100']],no_dollars:[[(1-ask).toFixed(3),'100']]}};
  else if(url.pathname==='/api/markets/trades')body={cursor:'',trades:Array.from({length:6},(_,j)=>({trade_id:stage+'-'+j,ticker:ticker(),created_time:new Date(start+stage*2000).toISOString(),count_fp:'10',taker_side:j===0?'no':'yes',yes_price_dollars:ask.toFixed(3),no_price_dollars:(1-ask).toFixed(3)}))};
  else body={market:market()};
  await route.fulfill({json:body});
 });
 await page.goto('http://127.0.0.1:8787/');
 await page.waitForFunction(()=>document.getElementById('feedBadge').textContent==='Updating · REST');
 assert.equal(await page.locator('#planSide').innerText(),'NO ENTRY');
 for(stage=1;stage<=18;stage++){
  await page.clock.setFixedTime(start+stage*2000);
  await page.locator('#refreshLive').click();
  await page.waitForFunction(()=>!document.getElementById('refreshLive').disabled);
 }
 assert.equal(await page.locator('#planSide').innerText(),'BUY YES');
 const entry=await page.locator('#planEntry').innerText(),target=parseFloat(await page.locator('#planTarget').innerText())/100,stop=parseFloat(await page.locator('#planStop').innerText())/100;
 await page.locator('#freezePlan').click();assert.match(await page.locator('#planSide').innerText(),/FROZEN/);
 stage=20;forcedBid=target+.01;await page.clock.setFixedTime(start+40000);await page.locator('#refreshLive').click();await page.waitForFunction(()=>!document.getElementById('refreshLive').disabled);
 assert.equal(await page.locator('#planEntry').innerText(),entry);assert.match(await page.locator('#planReason').innerText(),/Take-profit bid reached/);
 forcedBid=stop-.01;stage=21;await page.clock.setFixedTime(start+42000);await page.locator('#refreshLive').click();await page.waitForFunction(()=>!document.getElementById('refreshLive').disabled);assert.match(await page.locator('#planReason').innerText(),/Stop bid/);
 await page.locator('#planHeading').scrollIntoViewIfNeeded();await page.screenshot({path:'../plan-desktop.png'});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('section:has(#planHeading)').screenshot({path:'../plan-mobile.png'});
 await page.clock.setFixedTime(start+70000);await page.clock.runFor(500);assert.match(await page.locator('#planReason').innerText(),/stale/);
 roll=true;await page.clock.setFixedTime(start+610000);await page.clock.runFor(500);await page.waitForFunction(()=>document.getElementById('planReason').textContent.includes('Previous contract'));
 await page.locator('#freezePlan').click();assert.equal(await page.locator('#planSide').innerText(),'NO ENTRY');assert.equal(await page.locator('#planEntry').innerText(),'—');
 assert.deepEqual(errors,[]);console.log('PASS: no-entry warmup, confirmed plan, frozen levels, bid-based profit/stop, stale/rollover guards and mobile layout.');
}finally{await browser.close();}
