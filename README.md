# BTC Scalp Desk

## Four-way 15-minute BTC model experiment (review branch, October 25, 2026)

This branch adds a **paper-only** volatility-gap baseline as a fourth strategy alongside the established scalp rules, AstroTick-inspired momentum/book imbalance, and the prior hybrid. The live card **Volatility-gap baseline · 15m paper filter** displays estimated YES/NO settlement probabilities, strike gap measured in model sigma, and the fee-aware settlement-only gate. The original live BUY/WAIT, open-paper-position, and optional manual tracking logic are unchanged.

The new `gap-baseline.js` is an independently implemented research adaptation of the M0 zero-drift normal/lognormal averaged-settlement idea in [schen9999/btc-15m-engine](https://github.com/schen9999/btc-15m-engine) and the confidence-gap filter in [darup67/kalshi-btc-agent](https://github.com/darup67/kalshi-btc-agent). It **does not** load Chronos-2, LightGBM, third-party models, or their historical calibration tables. It derives an illustrative per-second volatility estimate from five minutes of **actual** official BRTI observations at ten-second spacing, rejecting gaps, stale feeds and the final settlement minute (partial minute averages are not reconstructed). No substitute spot price is presented as official BRTI.

The model's paper call needs modeled YES or NO probability of at least 95%, valid two-sided Kalshi quotes, displayed size, a spread of at most three cents, and at least two cents per contract of **modeled settlement-only EV** after an estimated quadratic entry fee. These are intentionally restrictive **uncalibrated research gates**, not observed 95% accuracy, a prediction of seven-minute resale profitability, or a proof of positive expected value. An early exit pays an additional fee and can be worse than the displayed bid. Do not transfer published accuracy statistics from the upstream projects to this adaptation.

The recorder's **Compare four paper strategies** action now replays the gap model on the same saved rounds. Each strategy uses the same observed next-ask/observed-bid fill assumptions, quadratic fee estimate, loss caps, and uncertainty handling. The gap model needs five minutes of recorded source-time BRTI, while Astro/hybrid additionally require recorded order-book depth; the comparison shows each model's eligible snapshots so coverage differences are visible. All returns are hypothetical; no queue-priority or real fills are verified. No officially verified settlement-probability Brier score is claimed; future calibration requires sufficient independently verified contract resolutions.

Run `npm test` for the baseline and existing replay tests. Browser-cache version 38 includes both new browser modules. Merge/redeploy is required to publish this branch to GitHub Pages/Render; creating this branch does not update the live site.


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

## As-observed full-model recorder and paper replay (October 25, 2026)

**New feature:** the Node backend records active BTC15M market metadata, actual best bid/ask and top-level order-book liquidity, deduplicated trades with both exchange and first-seen timestamps, and official BRTI observations (when authorized) roughly every five seconds while the server is running. Recorded events are checkpointed to JSON files in `BTC_RECORDER_DIR` or, by default, a **temporary** local directory. Records from the old browser-only one-minute candle importer are **not** enough for this shared-engine replay.

The GitHub Pages dashboard includes **Live-data recorder & actual-model paper replay**. It accesses `/api/model/status`, `/api/model/replay`, and `/api/model/export` using the same private `BRTI_VIEW_TOKEN` from its private viewing-token form. The replay calls the actual `SignalEngine`, `applyBrtiVeto` and `suggestPlan`, requiring complete fresh quote, trade and BRTI coverage before scoring a directional call. It models a buy no earlier than the *next observed ask*, a bid-based exit, displayed available top-of-book quantities, configurable per-side illustrative fees, seven-minute maximum holding time and unresolved outcomes when observations are missing. The report displays data coverage, signals, only hypothetical exits, fees, a bankroll curve and a trade log. **Order placement and execution are not verified.**

### Critical: Render Free will NOT collect durable 24/7 history

The current `render.yaml` specifies `plan: free`. Render Free instances spin down after approximately 15 minutes without inbound traffic and lose local filesystem changes on restart, redeploy or spin-down. Even with regular traffic, upstream 429s and server interruptions produce marked gaps. A `$1,000` replay begun today does not give an instant backtest of older contracts with no recorded order books.

- On Free, open the recorder dashboard and use **Export recorded rounds (JSON)** before deploys or restarts if you want a manual backup. No automatic external backup is configured.
- For ongoing recording, upgrade the **Render web service instance** to a paid instance, attach a persistent disk at e.g. `/var/data`, and set `BTC_RECORDER_DIR=/var/data/btc-recordings` in the service environment. Merely setting the variable without mounting an actual persistent disk is insufficient.
- Before real money, evaluate **many** independent complete rounds and out-of-sample data. Compare against a baseline, monitor signal freshness and book gaps, and verify real Kalshi fees and execution assumptions. Reported balances exclude unresolved open exposure.
- The private export file contains authorized historical BRTI observations; do not share it publicly. Never put Kalshi API secrets in the recorder files or a public repository.

## Live hypothetical position, projected upside and audit cutoffs

The dashboard now contains **Hypothetical open position · live HOLD / EXIT** directly after the BTC scalp cockpit. The paper monitor is independent of the manual, user-confirmed position tracker. It observes a **confirmed live signal and valid live entry plan** and waits for the NEXT fresh order-book quote, checking the intended buy-limit ceiling, spread and visible ask size. It never treats a signal itself as proof of a fill, and never sends an order.

While the hypothetical entry is active it reports **HOLD / MONITOR, HOLD · CAUTION, TAKE PROFIT, STOP / EXIT, DATA UNAVAILABLE, or an unresolved missing-data state**, plus the recorded hypothetical entry, latest valid sell bid, gross bid-based return, quantity and a countdown. Profit/stop triggers are conditional on adequate displayed bid size. The monitoring window ends at the EARLIER of seven minutes after entry or one minute before the contract's official close. Quotes more than 15 seconds apart cause an unresolved observation rather than an invented exit; stale bid/return metrics are hidden. All values are hypothetical, *not* real positions, guaranteed fills, or execution advice.

The separate **experimental projected gross return** is based on the observed previous ~30 seconds of the Kalshi YES contract's bid/ask midpoint. Its trend is adjusted for YES or NO and projected over the remaining holding interval using a damped 60-second momentum formula, bounded to a valid contract bid range. It may be positive **or negative**. **It is uncalibrated, not an estimated win probability, not validated expected return, and not a claim that a limit order will fill.** The independent **plan target gross upside** is shown alongside it so the plan's target is not confused with a prediction.

The original 7-minute scalp audit now records the earlier of the same seven-minute horizon or one-minute pre-close buffer. Earlier exits are counted separately (`cutoff_exit`) from full 7-minute samples (`complete`), and only the last observed bid in the 15 seconds BEFORE the cutoff can mark a hypothetical exit. A genuine unexpected contract switch gets `market_changed`; a normal expired-contract rollover gets `market_closed` if no valid exit quote was observed. Disconnections are reported as `data_gap` or `exit_quote_missing`. Existing browser-local audit records remain in place; missing historical quotes are not retroactively guessed.

## AstroTick-inspired experimental comparison (October 25, 2026)

This project retains the **original SignalEngine/BRTI veto and live BUY/WAIT behavior**. The two new models are **independent, paper-only experiments** inspired by [AstroTick](https://github.com/Razzleberryss/AstroTick) (Apache-2.0):

1. **AstroTick-inspired**: 60% normalized five-minute *observed official BRTI* momentum plus 40% price-weighted YES/NO top-ten bid imbalance. A clipped midpoint-plus-score "YES probability" is a **heuristic**, not a trained or calibrated probability. Its edge check, fee-sensitive 35–56¢ forbidden band, maximum probability deviation and fee-aware hypothetical settlement EV filter follow the ideas in AstroTick. Our port keeps a tighter **3¢** maximum spread appropriate for scalp research, rather than its permissive default.
2. **Hybrid**: our existing trade-pressure / quote-momentum / fast-slow chart / BRTI-veto entry, plus a *same-direction* weighted order-book skew of at least 10 percentage points. No new signal is produced by skew alone.
3. **Baseline**: our unchanged live signal rules, with the same estimated fee and paper-risk gates as the other two **for fair comparison**. The comparison's fee/risk gating is additional to the existing standalone baseline replay, and does not modify live entry eligibility.

The server recorder saves top-ten *observed* bid levels in each new BTC15M order-book sample. **Previously recorded market samples did not capture those levels** and cannot be backfilled accurately from one-minute candles. The comparison refuses to run Astro/hybrid on those depth-missing observations; "0 trades" is not evidence of failure. AstroTick-inspired five-minute BRTI context similarly requires five minutes of source-timestamped historical index values. All three share the same contract set, baseline quote snapshots, hypothetical next-ask entry, displayed size, 7-minute / pre-close bid exit, and **quadratic taker fee estimates**.

The common paper risk limits default to **$50 maximum stake/exposure per entry, $100 maximum cumulative realized losses per UTC day, and 10 completed trades per UTC day**. The fee-aware gate also requires a net target reward-to-risk ratio of at least 1.5, evaluated against published plan targets and the quadratic fee estimate. It never submits an order and cannot establish whether the displayed liquidity was actually executable. Unknown outcomes/exposure are flagged separately, not counted as completed gains.

- See **AstroTick-inspired research · live order-book skew** for live read-only signals and the illustrative fees.
- In **Live-data recorder & actual-model paper replay**, select **Compare three paper strategies** to view the side-by-side results.
- Kalshi's [fees Help Center](https://help.kalshi.com/en/articles/13823805-fees) explains that markets can have differing fee schedules. This app models the general 7% quadratic taker formula with per-*order* cent rounding; it does not verify fees or fills in a live account.
- Do **not** interpret the heuristic YES probability as a tested likelihood or the resulting "settlement EV" as an expectation of profit from selling in seven minutes. Compare *actual paper scalp P/L after cost estimates* over enough complete out-of-sample rounds.
- Render Free stores the server-recorded order books on an **ephemeral** filesystem; deploys/restarts can erase history unless persisted externally or exported. Do not describe the comparison as durable historical evidence without checked coverage.

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
