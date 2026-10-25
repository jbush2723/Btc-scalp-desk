import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify,constants} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {authHeaders} from '../kalshi-auth.mjs';
import {BrtiFeed,parseTick} from '../brti-feed.mjs';
import {makeServer} from '../server.mjs';

const now=1800000000000;
const frame=(time=now,value='68000.12')=>({type:'cfbenchmarks_value',msg:{index_id:'BRTI',data:JSON.stringify({type:'value',id:'BRTI',time,value})}});
for(const type of ['ed25519','rsa'])test(type+' authentication signs the exact path without query parameters',()=>{
 const {privateKey,publicKey}=generateKeyPairSync(type,type==='rsa'?{modulusLength:2048}:{});
 const headers=authHeaders('test-key-id',privateKey,'/trade-api/v2/cfbenchmarks/values?id=BRTI',now);
 const message=Buffer.from(now+'GET/trade-api/v2/cfbenchmarks/values');
 const options=type==='ed25519'?publicKey:{key:publicKey,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:constants.RSA_PSS_SALTLEN_DIGEST};
 assert.ok(verify(type==='ed25519'?null:'sha256',message,options,Buffer.from(headers['KALSHI-ACCESS-SIGNATURE'],'base64')));
});
test('only fresh valid BRTI values are accepted',()=>{
 assert.equal(parseTick(frame(),now).value,68000.12);
 for(const value of ['',null,'NaN','-1',{},0])assert.equal(parseTick(frame(now,value),now),null);
 for(const time of [now-5001,now+2001,null,1.5])assert.equal(parseTick(frame(time),now),null);
 const wrong=frame();wrong.msg.index_id='ETHUSD_RTI';assert.equal(parseTick(wrong,now),null);
 assert.equal(parseTick({type:'subscribed'},now),null);
});
test('feed deduplicates ticks, hides stale prices, and reconnects after loss',async()=>{
 let time=now;const sockets=[];
 class Socket extends EventEmitter{constructor(){super();sockets.push(this);}send(s){this.sent=JSON.parse(s);}terminate(){this.emit('close');}}
 const {privateKey}=generateKeyPairSync('ed25519');
 const feed=new BrtiFeed({credentials:async()=>({keyId:'test-key-id',key:privateKey}),Socket,now:()=>time});
 await feed.connect();const socket=sockets[0];socket.emit('open');
 assert.deepEqual(socket.sent.params,{channels:['cfbenchmarks_value'],index_ids:['BRTI']});
 assert.equal(feed.snapshot().price,null);
 socket.emit('message',JSON.stringify(frame()));socket.emit('message',JSON.stringify(frame()));socket.emit('message',JSON.stringify(frame(now-1)));
 assert.equal(feed.snapshot().history.length,1);assert.equal(feed.snapshot().price,68000.12);
 time+=5001;assert.equal(feed.snapshot().status,'stale');assert.equal(feed.snapshot().price,null);
 socket.terminate();assert.equal(feed.snapshot().history.length,0);
 time+=60000;await feed.maintain();assert.equal(sockets.length,2);feed.stop();
});
test('auth and subscription failures retain useful status without exposing upstream errors',async()=>{
 class Socket extends EventEmitter{send(){} terminate(){this.emit('close');}}
 const {privateKey}=generateKeyPairSync('ed25519');
 const feed=new BrtiFeed({credentials:async()=>({keyId:'test-key-id',key:privateKey}),Socket,now:()=>now});
 await feed.connect();feed.socket.emit('unexpected-response',null,{statusCode:403,resume(){}});
 assert.equal(feed.snapshot().status,'access_denied');assert.equal(feed.snapshot().price,null);
 assert.ok(!JSON.stringify(feed.snapshot()).includes('test-key-id'));feed.stop();
});
test('TLS handshake clock calibration accepts fresh ticks despite a slow local clock',async()=>{
 let time=now;class Socket extends EventEmitter{send(){} terminate(){this.emit('close');}}
 const {privateKey}=generateKeyPairSync('ed25519');
 const feed=new BrtiFeed({credentials:async()=>({keyId:'test-key-id',key:privateKey}),Socket,now:()=>time});
 await feed.connect();feed.socket.emit('upgrade',{headers:{date:new Date(now+6000).toUTCString()}});feed.socket.emit('open');
 feed.socket.emit('message',JSON.stringify(frame(now+6000)));
 assert.equal(feed.snapshot().status,'live');assert.equal(feed.snapshot().ageMs,500);
 time+=6000;assert.equal(feed.snapshot().price,null);feed.stop();
});
test('HTTP serves a sanitized snapshot and never serves credentials or server source',async()=>{
 const server=makeServer({brti:{start(){},stop(){},snapshot(){return {status:'setup_required',price:null};}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
   const base='http://127.0.0.1:'+server.address().port;
   assert.deepEqual(await (await fetch(base+'/api/brti')).json(),{status:'setup_required',price:null});
   for(const path of ['/.local/kalshi.json','/kalshi-auth.mjs','/brti-feed.mjs','/setup-kalshi.mjs'])assert.equal((await fetch(base+path)).status,404);
 }finally{await new Promise(r=>server.close(r));}
});
