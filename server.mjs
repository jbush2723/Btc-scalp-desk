import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRelay,upstreamPath} from './relay.mjs';
const root=new URL('./',import.meta.url), relay=createRelay();
const assets=new Map([['/','index.html'],...['index.html','app.js','flow.js','signal.js','plan.js','chart.js','manual.js','config.js','styles.css','sw.js','manifest.webmanifest'].map(x=>['/'+x,x])]);
const mime={html:'text/html',js:'text/javascript',css:'text/css',webmanifest:'application/manifest+json'};
export function makeServer(){return createServer(async(req,res)=>{
  const origin=req.headers.origin;
  const allowed=new Set(['https://jbush2723.github.io',...(process.env.ALLOWED_ORIGINS||'').split(',').filter(Boolean)]);
  if(origin&&allowed.has(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Expose-Headers','Retry-After');}
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  try {
    const u=new URL(req.url,'http://localhost');
    if(u.pathname==='/health'){res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return;}
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
});}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||8787),host=process.env.HOST||'127.0.0.1';
  makeServer().listen(port,host,()=>console.log('BTC Scalp Desk: http://'+host+':'+port));
}
