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
 console.log('PASS: official live BRTI price and chart, mobile layout, stale hiding and access-denied states; no browser errors.');
}finally{await browser.close();}
