export const WINDOWS = [10, 30, 60];
export const finite = v => v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
export const price = v => { const n = finite(v); return n !== null && n >= 0 && n <= 1 ? n : null; };
export const closeTime = m => Date.parse(m?.close_time || '');
export function selectMarket(markets, now = Date.now()) {
  return markets.filter(m => /^KXBTC15M-/.test(m.ticker) && ['open', 'active'].includes(m.status) && Date.parse(m.open_time) <= now && closeTime(m) > now)
    .sort((a,b) => closeTime(a) - closeTime(b))[0] || null;
}
export function normalizeBook(data) {
  const fp = data?.orderbook_fp, legacy = data?.orderbook;
  const levels = (rows, divisor = 1) => (Array.isArray(rows) ? rows : []).map(([p,q]) => [price(finite(p) === null ? null : Number(p) / divisor), finite(q)])
    .filter(([p,q]) => p !== null && q !== null && q > 0).sort((a,b) => b[0] - a[0]);
  if (fp) return { yes: levels(fp.yes_dollars), no: levels(fp.no_dollars) };
  if (data?.t === 'book') return { yes: levels(data.yes), no: levels(data.no) };
  if (legacy) return { yes: levels(legacy.yes, 100), no: levels(legacy.no, 100) };
  throw Error('Unrecognized order book response');
}
export function bookQuote(book) {
  const [yb, yq] = book.yes[0] || [null, null], [nb, nq] = book.no[0] || [null, null];
  return { yesBid: yb, yesAsk: nb === null ? null : 1-nb, noBid: nb, noAsk: yb === null ? null : 1-yb,
    yesBidSize: yq, yesAskSize: nq, noBidSize: nq, noAskSize: yq };
}
export class TradeFlow {
  constructor() { this.reset(''); }
  reset(ticker) { this.ticker = ticker; this.trades = new Map(); }
  add(items, now = Date.now()) {
    for (const t of items) {
      if (!t || t.ticker !== this.ticker || !t.trade_id || t.is_block_trade === true) continue;
      const at = Date.parse(t.created_time), count = finite(t.count_fp ?? t.count);
      if (!Number.isFinite(at) || at > now + 5000 || at < now - 120000 || count === null || count <= 0) continue;
      // taker_side is the legacy YES/NO aggressor field, not taker_book_side (bid/ask).
      const side = t.taker_outcome_side ?? t.taker_side;
      if (!this.trades.has(t.trade_id)) this.trades.set(t.trade_id, { id:t.trade_id, at, count,
        side: ['yes','no'].includes(side) ? side : 'unknown', yes:price(t.yes_price_dollars), no:price(t.no_price_dollars) });
    }
    this.prune(now);
  }
  prune(now) { for (const [id,t] of this.trades) if (t.at <= now - 120000) this.trades.delete(id); }
  totals(seconds, now = Date.now()) {
    this.prune(now);
    const out = {yes:0,no:0,unknown:0,count:0};
    for (const t of this.trades.values()) if (t.at > now-seconds*1000 && t.at <= now) { out[t.side] += t.count; out.count++; }
    return {...out, net:out.yes-out.no};
  }
  recent(now = Date.now()) { return [...this.trades.values()].filter(t => t.at <= now).sort((a,b)=>b.at-a.at).slice(0,20); }
}
export async function fetchTradeWindow(get, ticker, now, maxPages = 12) {
  const trades = [], cursors = new Set();
  let cursor = '', complete = false;
  // Freeze both ends so pagination cannot drift as fresh trades arrive.
  const params = new URLSearchParams({ticker, limit:'1000', min_ts:String(Math.floor((now-65000)/1000)), max_ts:String(Math.floor(now/1000)), is_block_trade:'false'});
  for (let page = 0; page < maxPages; page++) {
    if (cursor) params.set('cursor',cursor);
    const data = await get('/markets/trades?'+params);
    if (!Array.isArray(data.trades)) throw Error('Invalid trade response');
    trades.push(...data.trades);
    cursor = data.cursor || '';
    if (!cursor) { complete = true; break; }
    if (cursors.has(cursor)) break;
    cursors.add(cursor);
  }
  return { trades, complete, through:Math.floor(now/1000)*1000 };
}
