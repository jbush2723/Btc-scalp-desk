# BTC Scalp Desk

Read-only BTC 15-minute Kalshi companion. Frontend: https://jbush2723.github.io/Btc-scalp-desk/

## Feed status and source decision (October 25, 2026)

- Replaced the original malformed JavaScript and duplicated HTML/script tail.
- A browser on the GitHub Pages origin connected to `wss://maxycharts.com/ws` and received its `hello` response. No published third-party API permission was found in the inspected homepage or searches, so **MaxyCharts is not enabled**. Reachability is not authorization. No Origin spoofing or restriction bypass is used.
- Kalshi's documented public REST API works from the Node backend. Direct browser fetches from the GitHub Pages origin failed in the tested browser. GitHub Pages only serves static files; **public live data needs a hosted backend URL**. The page reports unavailable data explicitly until connected.
- Kalshi's WebSocket handshake requires authenticated headers even for public channels. Contract data polls documented public REST endpoints without credentials. The optional BRTI connection uses the authenticated CF Benchmarks WebSocket channel.
- No Coinbase or CoinGecko spot price is treated as BRTI. The published Kalshi strike is separate from the live BRTI panel and manual calculator. BRTI requires local API-key setup.

## Run the complete dashboard locally

Install Node.js 22 or newer, then in this repository:

```sh
npm install
node server.mjs
```

Open http://127.0.0.1:8787/. Install dependencies first. Public contract data needs no API keys; official BRTI needs the optional setup below. The server binds to loopback by default. Keep it running while using the local dashboard.

## Put the backend online

`render.yaml` defines a Node web service using the free plan. It is prepared configuration, **not an already deployed service**. A hosting account and user deployment are still required. Review the host's terms and capacity when deploying.

1. In Render, create a Blueprint from `jbush2723/Btc-scalp-desk`, or create a Node Web Service with build command `npm install --omit=dev`, start command `node server.mjs`, and environment variable `HOST=0.0.0.0`.
2. Wait for the service to deploy and verify its `/health` URL. The service also serves the full dashboard with its backend automatically connected.
3. To retain GitHub Pages as the frontend, enter `https://YOUR-SERVICE.onrender.com/api` under **Feed connection**. This setting is saved only in that browser. Alternatively set `API_BASE` in `config.js` to that address and commit it to configure all visitors.

Other Node hosts work too: use `HOST=0.0.0.0` and the host's `PORT`. CORS allows `https://jbush2723.github.io`; extra origins can be listed in the `ALLOWED_ORIGINS` environment variable, comma-separated. No credentials belong in `config.js` or the public repository. Hosting sleep, upstream availability and network delays can interrupt updates; the UI hides stale quotes and volumes.

The backend only permits BTC market discovery, individual market snapshots, order-book snapshots and executed trades. It cannot place orders or access portfolios. It uses a fixed documented Kalshi upstream, a brief cache, request coalescing, concurrency limits, timeouts and upstream rate-limit backoff. Denied upstream requests are surfaced rather than retried through alternative identities or hosts.

## Data behavior

### UP / DOWN / WAIT / SIT OUT signal

The top panel distinguishes the **scalp signal**, the **30-second contract trend**, and the **market's current leaning**. These are transparent, unbacktested heuristic rules, not a BTC/BRTI price forecast, calibrated win probability, or a verified profitable strategy. Fees and slippage are not included.

- UP requires YES midpoint momentum of at least +1¢ over approximately 30 seconds and YES taker-volume shares of at least 60% / 55% / 50% over 10 / 30 / 60 seconds. DOWN mirrors these rules for NO flow and declining YES prices.
- Confirmation requires three distinct fresh quote snapshots spanning at least four seconds. Repainting the screen cannot confirm a signal.
- SIT OUT on conflicting signals, stale/incomplete data, a quote/trade cutoff over six seconds old, a spread above 3¢, fewer than five executions or twenty known-side contracts in ten seconds, more than 10% unknown-side volume in any window, or sixty seconds or less to close.
- Trend uses YES bid/ask midpoint changes, not last-trade bounce. Less than 1¢ movement is SIDEWAYS. Market leaning uses the midpoint relative to 50¢ and can disagree with trend.
- Thirty seconds of uninterrupted observed quotes are needed at startup and after rollover. Gaps above eight seconds and invalid/crossed books reset quote history. There is no signal when the feed is unavailable.

### Entry and exit plans

The entry/exit panel proposes illustrative contract-price levels only when the UP/DOWN signal is confirmed. Entry is the current ask of that outcome, expressed as a buy-limit ceiling. Take profit and stop triggers are evaluated against the **same outcome's bid**, not its ask or the other outcome's price. Levels use the market's published `price_ranges`; NO increments mirror the YES price grid. Missing/invalid tick metadata suppresses a plan.

The planned price-risk distance is `max(2 cents, twice the spread, half the recent midpoint range)`. The stop rounds down to an allowed price; target rounds up to at least two times actual rounded risk above entry. Plans are rejected when risk exceeds 10 cents, the target cannot fit below the tradable ceiling, liquidity/history is missing, or fewer than 60 seconds remain. These are unbacktested design choices, not optimal entries or price forecasts. A stop trigger does not cap losses or guarantee an exit.

An optional round-trip fees/slippage allowance in cents per contract subtracts from reward and adds to planned risk. When supplied, at least 1.5:1 estimated net reward/risk is required. Blank means gross only, **not zero fees**; verify actual fees in Kalshi's order ticket. No account, fee tier, fill or position information is collected.

**Freeze this plan** saves an in-memory reference with fixed prices, ticker, timestamp and cost assumption. It places no orders and does not imply an entry filled. The page checks the original side's current bid for target/stop crossings, flags lost signal confirmation, stale data and market rollover, and does not silently move the levels. Release returns to live suggestions; reload clears the frozen reference. Levels from a previous contract remain explicitly labeled as inapplicable to the new contract.

### Quote and flow mechanics

### Chart confirmation and MaxyCharts

The visible contract chart plots up to 90 seconds of YES midpoints observed while this page is open, plus fast (10-second exponential time constant) and slow (30-second time constant) lines. UP requires the current midpoint above the fast line and fast above slow by at least 0.1¢; DOWN requires the reverse. This chart confirmation is in addition to the prior momentum, volume, freshness and spread checks. The chart resets across rollover/gaps and does not claim to be BTC spot or BRTI. There is no historical chart backfill.

MaxyCharts is available via a prominent **Open MaxyCharts** link. A real browser embed test on October 25, 2026 returned `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`; the browser blocked framing. The dashboard does not proxy the page, remove security headers or import its chart data. Kalshi's documented [CF Benchmarks feed](https://docs.kalshi.com/websockets/cfbenchmarks-value) requires authenticated access; configure it locally as described below.

### Entry suggestions without position tracking

The entry plan panel shows: BUY YES/NO at the suggested limit, consider half-profit at its displayed bid, full target and stop. No actual-entry or position form is required. The half-profit level is the midpoint between suggested entry and full target, rounded up to a published price increment. It is suppressed if it cannot fit below the full target or the supplied cost allowance would erase the partial profit. Blank costs mean gross profit only, not verified net profit.

For frozen plans, hold/half-sale/exit guidance is explicitly conditional on having entered near the suggested price. No actual holding, fill, sale or remaining quantity is inferred. Frozen levels are reference scenarios, not an account tracker.

### Quotes and flow

- Poll every two seconds **after the previous cycle finishes**, pause in hidden tabs, and retry errors with capped exponential backoff. This cadence is not a latency guarantee.
- Select the active `KXBTC15M` contract using `open_time` and `close_time`, not the later settlement/expiration timestamp. Clear quote, depth and flow state at rollover; ignore late previous-contract responses.
- Parse fixed-point dollar prices and fractional contract sizes. Prefer the order book for coherent bid/ask snapshots. A YES ask is the complement of the best NO bid, with that bid's size. Empty sides show no price.
- Fetch a bounded 65-second trade history with frozen `min_ts`/`max_ts`, follow cursors (up to 12 pages of 1,000 records), and flag incomplete history. Refresh with overlap and deduplicate by `trade_id` within the active market. Keep two minutes of IDs/events; older replayed events cannot enter a rolling window.
- Sum contract counts using exchange event timestamps in `(now − window, now]` for 10/30/60 seconds. Prefer `taker_outcome_side`, falling back to legacy `taker_side`. Never interpret `taker_book_side` as YES/NO. Unknown sides are separate; block trades are excluded. Net is YES minus NO contracts, not signed BTC volume or dollar notional.
- Trade history is complete only through the displayed fetch cutoff; the newest seconds may still be pending. Pagination limits show lower-bound side totals and suppress net. Stale data is hidden after 15 seconds (or 20 seconds behind the trade cutoff).
- Manual calculators and the local trade journal remain available independently of the feed. Existing journal entries are retained; content is rendered as text.
- Service worker v9 removes older application caches and never caches API responses. An offline shell does not imply live data.

## Verify

```sh
node --test tests/*.test.mjs
node --check app.js
node --check server.mjs
```

Optional browser regression with Playwright installed and the local server running:

```sh
node tests/browser.mjs
node tests/plan-browser.mjs
```

It uses installed Microsoft Edge by default; `BROWSER_CHANNEL` and `PLAYWRIGHT_MODULE` can override the browser channel/module path. Tests cover late responses across rollover, replayed IDs, stale-data hiding and invalid manual input. Unit tests cover window boundaries, fractional quantities, unknown/block/wrong-market trades, book complements, pagination and relay restrictions. Live desktop/mobile checks were also performed against the Node backend; no browser script errors or mobile page overflow were observed. Hosted backend deployment has not been performed.

## References

- [Kalshi public market data](https://docs.kalshi.com/getting_started/quick_start_market_data)
- [Trades and pagination](https://docs.kalshi.com/api-reference/market/get-trades)
- [Order book](https://docs.kalshi.com/api-reference/market/get-market-orderbook)
- [WebSocket authentication](https://docs.kalshi.com/getting_started/quick_start_websockets)
- [Render Blueprint configuration](https://render.com/docs/blueprint-spec)

## Official CF Benchmarks BRTI (local connection)

After saving a Kalshi private-key file, run `node setup-kalshi.mjs` and enter its path plus the Key ID. Ed25519 and RSA-PSS are supported. Setup stores only the identifier and file path in ignored `.local/kalshi.json`; the private key remains in the original file. Do not commit or upload either file. Alternatively supply `KALSHI_KEY_ID` and `KALSHI_PRIVATE_KEY_PATH` on the server.

The server subscribes only to `cfbenchmarks_value` with index `BRTI` at the documented production WebSocket URL. It does not request balances, positions or order access. Setup is retried automatically. Authentication or subscription failures are displayed without exposing upstream responses or credentials.

`/api/brti` is available only to loopback clients: this integration is for the user’s local dashboard, not public redistribution. Public GitHub Pages contains no key or BRTI data. A remote host alone does not enable this route. Confirm applicable data access and distribution permissions before designing a public feed.

The BRTI panel shows valid fresh ticks, up to 15 minutes of observed history and the supplied trailing 60-second average with its sample count. Partial averages are labeled; no settlement value is inferred. Duplicate/out-of-order, malformed, wrong-index and stale ticks are ignored. Prices hide after five seconds without a fresh source tick. Freshness accounts for local clock offset using the TLS WebSocket handshake Date header, not a price-derived timestamp adjustment. Reconnection clears prior chart history. The entry engine remains based on contract momentum, chart confirmation and executed flow; BRTI is a separate official reference, not an added trading signal.

### Confidence and no-entry states

WAIT means missing/stale data, warmup, unreliable taker-side data or pending chart/snapshot confirmation. SIT OUT means sideways/conflicting direction, a score below 60, insufficient activity, wide spread, final minute or an entry plan failing its price/risk checks. The 1–100 signal confidence is an uncalibrated directional-agreement score, not win probability: 25 × signed momentum capped at ±2 cents, 25 × chart-direction vote, and 20/15/15 × signed taker-share margins capped at ±10 percentage points for 10/30/60 seconds. Project the sum onto the momentum direction, round and clamp to 1–100. Sideways gets 1; missing/stale/insufficient/unreliable data shows no score. Existing entry eligibility and confirmation checks remain required.

The BRTI chart includes the current contract’s published strike as a gold dashed target line. The displayed dollar gap is green with an up arrow above target, red with a down arrow below target, and neutral at target. This is current distance, not a trend or settlement forecast. Missing/expired target or stale BRTI hides the gap. The target switches at rollover; source-price history remains BRTI history.
