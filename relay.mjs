// Only documented, unauthenticated BTC market-data endpoints. No arbitrary proxying.
export const UPSTREAM='https://external-api.kalshi.com/trade-api/v2';
const TICKER=/^KXBTC15M-[A-Z0-9-]{1,60}$/;
export function upstreamPath(url) {
  const u=new URL(url,'http://localhost'), path=u.pathname.replace(/^\/api/,'');
  const p=u.searchParams;
  if([...p.keys()].some(k=>p.getAll(k).length!==1)) throw Error('Duplicate parameter');
  let allowed;
  if(path==='/markets') {
    allowed=['series_ticker','status','limit','cursor'];
    if(p.get('series_ticker')!=='KXBTC15M'||!['open','settled','closed'].includes(p.get('status'))) throw Error('Only BTC 15m markets are available');
  } else if(path==='/historical/markets') {
    allowed=['series_ticker','limit','cursor'];
    if(p.get('series_ticker')!=='KXBTC15M')throw Error('Only BTC 15m history is allowed');
  } else if(/^\/(?:historical\/markets|series\/KXBTC15M\/markets)\/KXBTC15M-[A-Z0-9-]{1,60}\/candlesticks$/.test(path)) {
    allowed=['start_ts','end_ts','period_interval'];
    if(p.get('period_interval')!=='1')throw Error('Use actual 1-minute Kalshi candles');
    const start=Number(p.get('start_ts')),end=Number(p.get('end_ts'));
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<=0||end<=start||end-start>86400)throw Error('Invalid candle time range');
  } else if(path==='/markets/trades') {
    allowed=['ticker','limit','min_ts','max_ts','cursor','is_block_trade'];
    if(!TICKER.test(p.get('ticker')||''))throw Error('Invalid BTC ticker');
    if(p.has('is_block_trade')&&p.get('is_block_trade')!=='false')throw Error('Block trades are excluded');
    if(p.has('cursor')&&p.get('cursor').length>2048)throw Error('Cursor too long');
    for(const k of ['min_ts','max_ts']) if(p.has(k)&&!/^\d{1,12}$/.test(p.get(k)))throw Error('Invalid timestamp');
  } else {
    const match=path.match(/^\/markets\/(KXBTC15M-[A-Z0-9-]{1,60})(\/orderbook)?$/);
    if(!match)throw Error('Endpoint unavailable');
    allowed=match[2]?['depth']:[];
  }
  for(const [k,v] of p) {
    if(!allowed.includes(k))throw Error('Unsupported parameter');
    if(k==='limit'&&(!/^\d+$/.test(v)||Number(v)<1||Number(v)>1000))throw Error('Invalid limit');
    if(k==='cursor'&&v.length>2048)throw Error('Cursor too long');
    if(k==='depth'&&(!/^\d+$/.test(v)||Number(v)<1||Number(v)>100))throw Error('Invalid depth');
  }
  p.sort();return path+(p.size?'?'+p.toString():'');
}
export function createRelay(fetcher=fetch) {
  const cache=new Map(),pending=new Map();let retryAt=0,active=0;
  return async function relay(path) {
    const now=Date.now();
    if(now<retryAt)return {status:429,body:'{"error":"Upstream rate limit; retry later"}',retryAfter:String(Math.ceil((retryAt-now)/1000))};
    const hit=cache.get(path);if(hit&&now-hit.at<1000)return hit.result;
    if(pending.has(path))return pending.get(path);
    if(active>=12)return {status:429,body:'{"error":"Backend busy"}',retryAfter:'2'};
    const work=(async()=>{
      active++;
      try {
        const r=await fetcher(UPSTREAM+path,{signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'},redirect:'error'});
        // Do not retry denied requests through another host or spoof Origin/authentication.
        const body=await r.text();
        const result={status:r.status,body:r.ok?body:JSON.stringify({error:'Kalshi returned HTTP '+r.status}),retryAfter:r.headers.get('retry-after')||''};
        if(r.status===429){const seconds=Number(result.retryAfter);retryAt=Date.now()+(Number.isFinite(seconds)&&seconds>0?Math.min(seconds,120):30)*1000;}
        if(r.ok){JSON.parse(body);cache.set(path,{at:Date.now(),result});if(cache.size>200)cache.delete(cache.keys().next().value);}
        return result;
      } catch {return {status:502,body:'{"error":"Kalshi unavailable or response invalid"}',retryAfter:''};}
      finally {active--;pending.delete(path);}
    })();
    pending.set(path,work);return work;
  };
}
