# BTC Scalp Desk

Read-only BTC 15-minute Kalshi companion. Frontend: https://jbush2723.github.io/Btc-scalp-desk/

## Feed status and source decision (October 25, 2026)

- Replaced the original malformed JavaScript and duplicated HTML/script tail.
- A browser on the GitHub Pages origin connected to `wss://maxycharts.com/ws` and received its `hello` response. No published third-party API permission was found in the inspected homepage or searches, so **MaxyCharts is not enabled**. Reachability is not authorization. No Origin spoofing or restriction bypass is used.
- Kalshi's documented public REST API works from the Node backend. Direct browser fetches from the GitHub Pages origin failed in the tested browser. GitHub Pages only serves static files; **public live data needs a hosted backend URL**. The page reports unavailable data explicitly until connected.
- Kalshi's WebSocket handshake requires authenticated headers even for public channels. This project instead polls documented public REST endpoints without credentials. It is near-real-time polling, not tick-by-tick streaming.
- No Coinbase or CoinGecko spot price is treated as BRTI. The published Kalshi strike is shown separately from manual BRTI input. There is no official live BRTI stream connected.

## Run the complete dashboard locally

Install Node.js 22 or newer, then in this repository:

```sh
node server.mjs
```

Open http://127.0.0.1:8787/. No dependencies, API keys, or account access are needed. The server binds to loopback by default. Keep it running while using the local dashboard.

## Put the backend online

`render.yaml` defines a Node web service using the free plan. It is prepared configuration, **not an already deployed service**. A hosting account and user deployment are still required. Review the host's terms and capacity when deploying.

1. In Render, create a Blueprint from `jbush2723/Btc-scalp-desk`, or create a Node Web Service with build command `node --version`, start command `node server.mjs`, and environment variable `HOST=0.0.0.0`.
2. Wait for the service to deploy and verify its `/health` URL. The service also serves the full dashboard with its backend automatically connected.
3. To retain GitHub Pages as the frontend, enter `https://YOUR-SERVICE.onrender.com/api` under **Feed connection**. This setting is saved only in that browser. Alternatively set `API_BASE` in `config.js` to that address and commit it to configure all visitors.

Other Node hosts work too: use `HOST=0.0.0.0` and the host's `PORT`. CORS allows `https://jbush2723.github.io`; extra origins can be listed in the `ALLOWED_ORIGINS` environment variable, comma-separated. No credentials belong in `config.js` or the public repository. Hosting sleep, upstream availability and network delays can interrupt updates; the UI hides stale quotes and volumes.

The backend only permits BTC market discovery, individual market snapshots, order-book snapshots and executed trades. It cannot place orders or access portfolios. It uses a fixed documented Kalshi upstream, a brief cache, request coalescing, concurrency limits, timeouts and upstream rate-limit backoff. Denied upstream requests are surfaced rather than retried through alternative identities or hosts.

## Data behavior

- Poll every two seconds **after the previous cycle finishes**, pause in hidden tabs, and retry errors with capped exponential backoff. This cadence is not a latency guarantee.
- Select the active `KXBTC15M` contract using `open_time` and `close_time`, not the later settlement/expiration timestamp. Clear quote, depth and flow state at rollover; ignore late previous-contract responses.
- Parse fixed-point dollar prices and fractional contract sizes. Prefer the order book for coherent bid/ask snapshots. A YES ask is the complement of the best NO bid, with that bid's size. Empty sides show no price.
- Fetch a bounded 65-second trade history with frozen `min_ts`/`max_ts`, follow cursors (up to 12 pages of 1,000 records), and flag incomplete history. Refresh with overlap and deduplicate by `trade_id` within the active market. Keep two minutes of IDs/events; older replayed events cannot enter a rolling window.
- Sum contract counts using exchange event timestamps in `(now − window, now]` for 10/30/60 seconds. Prefer `taker_outcome_side`, falling back to legacy `taker_side`. Never interpret `taker_book_side` as YES/NO. Unknown sides are separate; block trades are excluded. Net is YES minus NO contracts, not signed BTC volume or dollar notional.
- Trade history is complete only through the displayed fetch cutoff; the newest seconds may still be pending. Pagination limits show lower-bound side totals and suppress net. Stale data is hidden after 15 seconds (or 20 seconds behind the trade cutoff).
- Manual calculators and the local trade journal remain available independently of the feed. Existing journal entries are retained; content is rendered as text.
- Service worker v3 removes older application caches and never caches API responses. An offline shell does not imply live data.

## Verify

```sh
node --test tests/flow.test.mjs tests/relay.test.mjs
node --check app.js
node --check server.mjs
```

Optional browser regression with Playwright installed and the local server running:

```sh
node tests/browser.mjs
```

It uses installed Microsoft Edge by default; `BROWSER_CHANNEL` and `PLAYWRIGHT_MODULE` can override the browser channel/module path. Tests cover late responses across rollover, replayed IDs, stale-data hiding and invalid manual input. Unit tests cover window boundaries, fractional quantities, unknown/block/wrong-market trades, book complements, pagination and relay restrictions. Live desktop/mobile checks were also performed against the Node backend; no browser script errors or mobile page overflow were observed. Hosted backend deployment has not been performed.

## References

- [Kalshi public market data](https://docs.kalshi.com/getting_started/quick_start_market_data)
- [Trades and pagination](https://docs.kalshi.com/api-reference/market/get-trades)
- [Order book](https://docs.kalshi.com/api-reference/market/get-market-orderbook)
- [WebSocket authentication](https://docs.kalshi.com/getting_started/quick_start_websockets)
- [Render Blueprint configuration](https://render.com/docs/blueprint-spec)
