import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {createRelay,upstreamPath} from './relay.mjs';
import {BrtiFeed} from './brti-feed.mjs';
import {MarketRecorder} from './market-recorder.mjs';
import {replayRecordedModel,compareRecordedStrategies} from './model-replay.mjs';
const root=new URL('./',import.meta.url), relay=createRelay();
const assets=new Map([['/','index.html'],...['index.html','app.js','brti-ui.js','cryptometer-ui.js','signal-audit.js','market-context.js','brti-candles.js','round-history.js','settlement-audit.js','position-tracker.js','paper-position.js','astro-experiment.js','astro-live-ui.js','historical-replay.js','kalshi-history.js','historical-flow.js','history-storage.js','full-replay-ui.js','settlement-forecast.js','flow.js','signal.js','plan.js','chart.js','manual.js','config.js','styles.css','sw.js','manifest.webmanifest'].map(x=>['/'+x,x])]);
const mime={html:'text/html',js:'text/javascript',css:'text/css',webmanifest:'application/manifest+json'};

const cryptoCache={at:0,data:null,pending:null};
async function cryptometerSnapshot(){
  if(!process.env.CRYPTOMETER_API_KEY)return {status:'not_configured',events:[]};
  if(cryptoCache.data && Date.now()-cryptoCache.at<900000)return cryptoCache.data;
  if(cryptoCache.pending)return cryptoCache.pending;
  cryptoCache.pending=(async()=>{
    const url=new URL('https://api.cryptometer.io/rapid-movements/');
    url.searchParams.set('api_key',process.env.CRYPTOMETER_API_KEY);
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),7500);
    try {
      const response=await fetch(url,{signal:controller.signal});
      if(!response.ok)throw Error('Cryptometer upstream HTTP '+response.status);
      const json=await response.json();
      if(String(json.success).toLowerCase()!=='true'||!Array.isArray(json.data))throw Error('Cryptometer response unavailable');
      const events=json.data.filter(x=>typeof x.pair==='string' && /^BTC[-/]/i.test(x.pair))
        .map(x=>({pair:x.pair,exchange:String(x.exchange||''),side:String(x.side||''),change:Number(x.change_detected),timestamp:String(x.timestamp||'')}))
        .filter(x=>Number.isFinite(x.change)&&Number.isFinite(Date.parse(x.timestamp)))
        .sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp)).slice(0,20);
      const result={status:'ok',asOf:new Date().toISOString(),events,source:'Cryptometer rapid movements (free; upward-move detector)'};
      cryptoCache.data=result;cryptoCache.at=Date.now();return result;
    } finally {clearTimeout(timeout);}
  })();
  try{return await cryptoCache.pending;}finally{cryptoCache.pending=null;}
}

function isAuthorized(req){
 const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
 if(local)return true;
 const expected=process.env.BRTI_VIEW_TOKEN||'';
 const supplied=typeof req.headers['x-brti-token']==='string'?req.headers['x-brti-token']:'';
 const a=Buffer.from(expected),b=Buffer.from(supplied);
 return Boolean(expected&&supplied&&a.length===b.length&&timingSafeEqual(a,b));
}
export function makeServer({brti=new BrtiFeed(),recorder=null}={}){
 const record=recorder||new MarketRecorder({brti,relay});
 const server=createServer(async(req,res)=>{
  const origin=req.headers.origin;
  const allowed=new Set(['https://jbush2723.github.io',...(process.env.ALLOWED_ORIGINS||'').split(',').filter(Boolean)]);
  if(origin&&allowed.has(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Expose-Headers','Retry-After');}
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS' && origin && allowed.has(origin)){res.setHeader('Access-Control-Allow-Methods','GET, HEAD, OPTIONS');res.setHeader('Access-Control-Allow-Headers','X-BRTI-Token');res.writeHead(204);res.end();return;}
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  try {
    const u=new URL(req.url,'http://localhost');
    if(u.pathname==='/health'){res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return;}
    if(u.pathname==='/api/cryptometer'){
      res.setHeader('Content-Type','application/json');
      try{const result=await cryptometerSnapshot();res.end(req.method==='HEAD'?'':JSON.stringify(result));}
      catch{res.statusCode=503;res.end(req.method==='HEAD'?'':JSON.stringify({status:'unavailable',events:[]}));}
      return;
    }
    if(u.pathname==='/api/brti'){
      res.setHeader('Content-Type','application/json');
      if(!isAuthorized(req)){res.writeHead(403);res.end(JSON.stringify({status:'private_access_required',price:null}));return;}
      res.end(req.method==='HEAD'?'':JSON.stringify(brti.snapshot()));return;
    }
    if(u.pathname==='/api/model/status'||u.pathname==='/api/model/replay'||u.pathname==='/api/model/export'||u.pathname==='/api/model/compare'){
      res.setHeader('Content-Type','application/json; charset=utf-8');
      if(!isAuthorized(req)){res.writeHead(403);res.end(JSON.stringify({error:'Private BRTI viewing token required for model recorder access.'}));return;}
      if(u.pathname==='/api/model/status'){
        const status=record.summary();
        res.end(req.method==='HEAD'?'':JSON.stringify(status));return;
      }
      const limit=Math.min(60,Math.max(1,Number(u.searchParams.get('rounds'))||30));
      if(!Number.isInteger(limit)){res.writeHead(400);res.end('{"error":"Invalid round count"}');return;}
      const stored=record.getRounds(limit);
      if(u.pathname==='/api/model/export'){
        res.setHeader('Content-Disposition','attachment; filename="btc-scap-desk-observations.json"');
        res.end(req.method==='HEAD'?'':JSON.stringify({schema:1,source:'As-observed recorder; not a historic backfill',exportedAt:new Date().toISOString(),rounds:stored}));return;
      }
      const common={
        bankroll:Number(u.searchParams.get('bankroll')||1000),
        stake:Number(u.searchParams.get('stake')||50),
        feeCents:Number(u.searchParams.get('fee_cents')??1),
        maxDailyLoss:Number(u.searchParams.get('daily_loss')??100),
        maxDailyTrades:Number(u.searchParams.get('daily_trades')??10),
        maxExposure:Number(u.searchParams.get('max_exposure')??50),
        maxRounds:limit
      };
      const report=u.pathname==='/api/model/compare'?
        compareRecordedStrategies(stored,common):
        replayRecordedModel(stored,common);
      if(report.error)res.statusCode=400;
      res.end(req.method==='HEAD'?'':JSON.stringify(report));return;
    }
    if(u.pathname.startsWith('/api/')){
      let path;try{path=upstreamPath(u.href);}catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));return;}
      const r=await relay(path);res.statusCode=r.status;res.setHeader('Content-Type','application/json');if(r.retryAfter)res.setHeader('Retry-After',r.retryAfter);res.end(req.method==='HEAD'?'':r.body);return;
    }
    const file=assets.get(u.pathname);if(!file){res.writeHead(404);res.end('Not found');return;}
    let body=await readFile(new URL(file,root));
    // When hosted together, use the same-origin backend automatically.
    if(file==='config.js')body="export const API_BASE = new URL('./api', location.href).href.replace(/\\/$/, '');\n";
    res.setHeader('Content-Type',(mime[file.split('.').pop()]||'text/plain')+'; charset=utf-8');res.end(req.method==='HEAD'?'':body);
  } catch {res.writeHead(500);res.end('Server error');}
});server.on('listening',()=>{brti.start();void record.start();});server.on('close',()=>{void record.stop();brti.stop();});return server;}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||8787),host=process.env.HOST||'127.0.0.1';
  makeServer().listen(port,host,()=>console.log('BTC Scalp Desk: http://'+host+':'+port));
}
