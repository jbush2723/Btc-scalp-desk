import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MarketRecorder} from '../market-recorder.mjs';

test('server recorder captures continuous actual book, trades and BRTI and checkpoints to disk',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'btc-recorder-test-'));
 let clock=Date.now(),page=0;
 const ticker='KXBTC15M-TEST123';
 const market={ticker,status:'open',open_time:new Date(clock-60000).toISOString(),
  close_time:new Date(clock+900000).toISOString(),floor_strike:103000,
  price_ranges:[{start:.01,end:1,step:.01}]};
 const relay=async path=>{
  let data;
  if(path.startsWith('/markets?'))data={markets:[market]};
  else if(path.includes('/orderbook'))data={orderbook_fp:{yes_dollars:[['0.45','200']],no_dollars:[['0.53','190']]}};
  else if(path.includes('/markets/trades?')){
   data={trades:Array.from({length:7},(_,j)=>({
    ticker,trade_id:'test-'+page+'-'+j,created_time:new Date(clock-3500+j*200).toISOString(),
    count_fp:'10',taker_outcome_side:j%5===0?'no':'yes'})),cursor:''};page++;
  }else if(path.startsWith('/markets/'))data={market};
  else throw Error('Unexpected API path '+path);
  return {status:200,body:JSON.stringify(data)};
 };
 const brti={history:[],snapshot:()=>({status:'live',price:103100,sourceTime:clock-200,ageMs:200})};
 const recorder=new MarketRecorder({relay,brti,now:()=>clock,dir});
 recorder.running=true;
 try{
  for(let i=0;i<17;i++){
   brti.history.push({time:clock-200,value:103100+i*.15});
   await recorder.tick();clock+=5000;
  }
  const status=recorder.summary();
  assert.equal(status.totalRounds,1);
  assert.equal(status.lastError,'');
  assert.equal(status.rounds[0].samples,17);
  assert.equal(status.rounds[0].trades,119);
  assert.equal(status.rounds[0].brtiTicks,17);
  assert.ok(status.rounds[0].flowReady>0);
  await recorder.stop();
  const persisted=JSON.parse(await readFile(join(dir,ticker+'.json'),'utf8'));
  assert.equal(persisted.samples.length,17);
  assert.equal(persisted.trades.length,119);
  assert.deepEqual(persisted.samples[0].bookLevels.yes[0],[.45,200]);
  assert.deepEqual(persisted.samples[0].bookLevels.no[0],[.53,190]);
 }finally{
  await recorder.stop();
  await rm(dir,{force:true,recursive:true});
 }
});
