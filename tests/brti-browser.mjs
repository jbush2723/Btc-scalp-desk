import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8787/');
 await page.waitForFunction(()=>document.getElementById('brtiStatus').textContent==='LIVE · CF BRTI');
 assert.match(await page.locator('#brtiLivePrice').textContent(),/^\$[\d,]+\.\d{2}$/);
 await page.waitForFunction(()=>document.querySelector('#brtiChart path'));
 mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/brti-live.png'});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:'test-results/brti-mobile.png'});
 await page.route('**/api/brti',r=>r.fulfill({json:{status:'stale',price:null,history:[]}}));
 await page.waitForFunction(()=>document.getElementById('brtiLivePrice').textContent==='—');
 assert.equal(await page.locator('#brtiChart path').count(),0);
 assert.match(await page.locator('#brtiStatus').textContent(),/stale/);
 await page.route('**/api/brti',r=>r.fulfill({json:{status:'access_denied',price:null}}));
 await page.waitForFunction(()=>document.getElementById('brtiStatus').textContent.includes('denied'));
 assert.deepEqual(errors,[]);
 const comparison=await browser.newPage({serviceWorkers:'block',viewport:{width:390,height:844}});
 comparison.on('pageerror',e=>errors.push(e.message));
 let target=80000,value=80042.15,stale=false;const start=Date.now();
 const market=()=>({ticker:'KXBTC15M-TEST',floor_strike:target,status:'active',open_time:new Date(start-1000).toISOString(),close_time:new Date(start+600000).toISOString()});
 await comparison.route('**/api/**',route=>{
   const path=new URL(route.request().url()).pathname;
   const data=path==='/api/brti'?{status:stale?'stale':'live',price:stale?null:value,ageMs:0,sourceTime:Date.now(),history:[{time:start-2000,value:value-1},{time:start,value}]}:
     path==='/api/markets'?{markets:[market()]}:path.endsWith('/orderbook')?{orderbook_fp:{yes_dollars:[['.5','100']],no_dollars:[['.49','100']]}}:
     path.endsWith('/trades')?{trades:[],cursor:''}:{market:market()};
   return route.fulfill({json:data});
 });
 await comparison.goto('http://127.0.0.1:8787/');
 await comparison.waitForFunction(()=>document.getElementById('brtiDistance').textContent==='↑ $42.15 above target');
 assert.match(await comparison.locator('#brtiDistance').getAttribute('class'),/up/);
 assert.equal(await comparison.locator('#brtiTarget').textContent(),'$80,000.00');
 assert.equal(await comparison.locator('#brtiChart line[data-role="target"]').count(),1);
 assert.equal(await comparison.locator('#scalpAction').textContent(),'WAIT');
 assert.equal(await comparison.locator('#signalConfidence').textContent(),'—');
 value=79981.4;
 await comparison.waitForFunction(()=>document.getElementById('brtiDistance').textContent==='↓ $18.60 below target');
 assert.match(await comparison.locator('#brtiDistance').getAttribute('class'),/down/);
 target=79900;await comparison.locator('#refreshLive').click();
 await comparison.waitForFunction(()=>document.getElementById('brtiTarget').textContent==='$79,900.00');
 await comparison.waitForFunction(()=>document.getElementById('brtiDistance').textContent==='↑ $81.40 above target');
 assert.ok(await comparison.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await comparison.screenshot({path:'test-results/brti-target-mobile.png',fullPage:true});
 stale=true;await comparison.waitForFunction(()=>document.getElementById('brtiDistance').textContent==='—');
 assert.deepEqual(errors,[]);
 console.log('PASS: live BRTI/chart, target line and update, red/green arrows, dollar gaps, WAIT warmup, mobile layout, stale hiding and denied access.');
}finally{await browser.close();}
