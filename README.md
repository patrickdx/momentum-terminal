# VECTOR — Momentum Terminal

A static market research terminal for US, Canadian and South Korean stocks, published on GitHub Pages. GitHub Actions collects a snapshot every day at **23:17 UTC** (19:17 Toronto during daylight saving; 18:17 in winter; 08:17 the next day in Seoul). Refresh in the website reloads the latest published data; it does not run a new scan.

**Website:** https://patrickdx.github.io/momentum-terminal/

## Use the terminal

- The default universe is **US$1 billion+ market cap**, across every country. Change the cap dropdown or choose Any market cap; Reset restores US$1B+. Unknown USD market caps are excluded while a minimum is active. This is a size filter, not a guarantee of business quality.
- Choose a country, then screen by English company/ticker, detailed industry, technical setup, minimum momentum score or a quick filter.
- Click a company or table row to update the persistent research sidebar: the original six-month daily-close line/area chart, fundamentals, score components, news, signal history and insider/disclosure coverage. On smaller screens, research appears below the table. Logos appear beside English names, with initials when unavailable. The table includes USD market cap, industry, returns and repeat-signal counts.
- Open **Industry radar** for the original bubble chart: vertical position = average momentum, horizontal position = trend breadth, circle size = member count. Apache ECharts renders every industry with available coordinates, including one- and two-stock groups. Search filters the bubbles, complete scrollable list and cards together; hover/focus for details, use the zoom sliders or Ctrl + wheel, toggle labels, and reset zoom. Click a bubble or list entry to screen its members. Missing-coordinate industries remain listed explicitly; no point is fabricated. Coordinates are never jittered, and search/list access makes fully overlapping points reachable. Country and USD cap filters are shared with the screener.
- Choose **Recurring signals** for a signal active on at least 3 of the last 10 observed market sessions, including the latest observation. **Fresh repeat** finds a signal that switched off and then back on after an earlier hit. Click the **Repeat signals** column or the sidebar’s **Signals** tab to inspect dated hits, misses and missing observations.
- Star stocks to save a watchlist. Add a thesis in **Story & news**. Both live only in that browser and do not sync or become public.
- Use **Accelerating** to find scores up at least 3 points since the preceding successful scan day. This needs snapshots from two different days.
- Export the current filtered results as CSV. Press `/` to search.

## Momentum methodology

Scores are weighted combinations of within-country percentiles: one-month return 25%, three-month return 25%, one-week return 15%, 10-day relative volume 15%, moving-average alignment 10%, and price/52-week-high proximity 10%. Moving-average alignment is the fraction of the 20-, 50-, and 200-day simple averages below current price. Ties share their percentile. Missing inputs are omitted and available weights rescaled; under 70% input coverage the stock is unscored.

Ranks always use the complete eligible country cohort, not the currently filtered table. These are relative ranking signals, not predicted returns, probabilities, or personalized trading recommendations. Cohorts change as listings enter or leave liquidity thresholds, so rank and score changes can reflect cohort composition.

- **Near breakout:** within 3% of the 52-week high and relative volume at least 1.3×.
- **Trending:** above at least two moving averages and positive one-month return.
- **Extended:** more than 15% above the 20-day average, taking priority over other setups.

Industry membership uses the exact **FactSet industry** field supplied by TradingView, with one industry per company. These are detailed industries, not broad sector/industry groups. They are **not GICS** classifications; GICS labels are not inferred or fabricated. Company names are requested in English. Korean names are used internally only for local news searches.

Curated narrative tags (for explicitly mapped companies) and unverified headline keyword signals remain separate from industry classification. Headlines can never reclassify a company. Industry score is an equal-weight average of member momentum scores; breadth is the fraction of scored members with available trend data above at least two moving averages. Missing trend and return observations are excluded from their respective denominators. UI aggregates respect the USD cap filter; displayed daily changes average available member score changes. The saved industry-history taxonomy starts at classification version 2, and comparisons do not cross the taxonomy change.

Market caps are requested using TradingView's explicit `price_conversion: {"to_currency": "usd"}`. This converts fundamental-price fields, while quotes stay in their listing currency. `marketCapUsd` and `marketCapCurrency: "USD"` identify the unit; legacy `marketCap` is a USD alias in schema version 2. No local-currency market cap is silently interpreted as USD.


## Coverage and data provenance

| Source | What is collected | Limits |
| --- | --- | --- |
| TradingView scanner | Prices, returns, volume, averages, RSI, market cap, revenue growth, P/E, earnings dates, company logo IDs | Unofficial scanner interface; not a supported public market-data API; availability/entitlements may change. Delayed/as available; collection time is not an exchange quote timestamp. |
| Google News RSS | Up to eight headlines, publishers, timestamps and source links | Top 15 stocks above US$1B per market and configured focus symbols; seven-day search; no full articles. Search matches can be unrelated. Korean names are retrieved for Korean searches. |
| TradingView symbol logos | Provider logo IDs resolve to SVG images on `s3-symbol-logo.tradingview.com` | Loaded directly in the browser; absent or failed logos show company initials. |
| Yahoo Finance | Six months of daily closes for daily leaders/focus stocks; session dates from SPY, XIU.TO and KOSPI benchmarks | Original native SVG chart; no embedded TradingView widget. Unadjusted closes may differ from scanner prices. Previously collected charts are retained with their original end date if not refreshed. Stocks without collected history show an explicit empty state and an external full-chart link. Benchmark failure suppresses new signal observations. |
| Nasdaq insider activity | Up to 15 recent reported transactions for enriched US issuers | No API key; best effort. Source transaction labels retained. Automatic sales and non-open-market acquisitions are distinct; zero/unknown prices do not imply zero transaction value. |
| SEC EDGAR | Recent issuer filings and up to five Form 4 filings within 90 days per enriched US issuer | Needs a declared contact user-agent. Non-derivative transactions are parsed; awards, withholding, gifts, exercises, purchases and sales are distinct. This is not an exhaustive insider ledger. Form 4/A is linked but not merged into transaction records. |
| Korea DART | Officer/major-holder ownership reports | Needs a DART API key. Reported holdings changes are not asserted to be market trades. |
| Canada SEDI / SEDAR+ | Official lookup links | No automated Canadian transaction feed is connected. |

Country means **listing market**, not issuer domicile. The scanner requests primary common shares, up to 20,000 source records per country, then applies approximate turnover floors of 1 million US, 250 thousand Canadian, and 500 million Korean in the listing's own quote currency. Turnover is price × 10-day average share volume. No cross-currency conversion or comparison is implied. A source-count warning is shown if the cap truncates the universe.

Every market keeps its own collection timestamp and failure state. Failed market scans retain previous data; an all-source or partial market failure still deploys visible stale/unavailable status and then marks the workflow failed. Snapshots older than 36 hours display a warning, including weekends. Source enrichment failures are separate from market collection status.

History is retained for up to 90 successful full-market scan days in `site/data/history.json`. One record per UTC day is retained; a rerun replaces that day's record. A partial-market run is not used as a full-day comparison baseline. Historical scores are not reconstructed or backtested. The interface downloads only a compact seven-day score trail in `recent.json`, keeping load size bounded as the archive grows.

## Recurring momentum signals

The daily GitHub Actions scan saves `site/data/signals.json`, retaining up to 90 **unique exchange sessions per country**. The latest snapshot carries a compact 10-session trail for each stock; the browser never downloads the full signal archive. Existing UTC-day score history remains separate and is not used to reconstruct these signals.

| Signal | A hit means |
| --- | --- |
| Strong momentum | Country-relative momentum score ≥ 80 |
| Volume thrust | Relative volume ≥ 2× and daily return > 0 |
| Breakout pressure | Price ≥ 97% of its 52-week high and relative volume ≥ 1.3× |

**Recurring:** the same signal hits on at least 3 of the last 10 observed sessions and is on in the latest observation. Different signal types are never added together. **Fresh repeat:** an observed off → on transition, with at least one earlier hit for that same signal in the window; two hits can qualify. **Streak:** consecutive observed hits for the same signal. A missing stock/input breaks a streak and cannot establish an off → on transition. The sidebar shows hit/known counts separately for each signal and dates for every observation. CSV exports include the signal as-of date and window size.

The scanner verifies the last daily bar and quote date in each benchmark’s exchange timezone, rejects unsettled/intraday, mismatched or stale benchmarks, and records the first successful observation of a completed session. Reruns, weekends and holidays cannot append duplicate dates or rewrite an existing observation. Failed market scans or unverified session dates add no record and suppress current recurring/fresh-repeat flags; historical evidence remains dated and visible. Missed scans can leave gaps, so “observed sessions” does not imply every trading session was captured. Signals describe the latest verified observation, not a live feed.

History starts at activation. The previous archive lacks full signal inputs and exchange-session timestamps, so no historical recurrence is fabricated. The first observation is September 11, 2026; more sessions accumulate through scheduled pulls. These are transparent screening rules, not a backtested forecast.

## Configure extra coverage

Edit `config.json` and add exchange-qualified identifiers to `focusSymbols`, such as `NASDAQ:NVDA`, `TSX:CCO` or `KRX:005930`. This adds daily news and insider enrichment for those issuers, even outside the top 15 stocks above US$1B. The original sidebar chart uses saved Yahoo daily closes. Daily leaders and configured focus symbols receive fresh history; older collected series are retained with their original end dates. Browser stars do not modify the server-side focus list.

In GitHub **Settings → Secrets and variables → Actions**, optionally add:

- `SEC_USER_AGENT`: your name/application and real contact email, e.g. `MyMomentumResearch me@example.com`. Requests are sequential with a pause for SEC fair-access limits. Network-level SEC blocking may still prevent collection.
- `DART_API_KEY`: a Korean Open DART authentication key from https://opendart.fss.or.kr/.

Do not place secrets in `site/`, `config.json`, or committed environment files. The site is public. The collector reads secrets only in the workflow runtime; URLs containing DART keys are never saved in snapshots or logged.

## Run locally

Python 3.10+ and Node 18+ are enough. There are no application npm or Python dependencies and no build step.

```sh
python3 scripts/scan.py --enrich 15
python3 -m http.server 4173 --directory site
```

Open http://localhost:4173. For verification:

```sh
npm test
python3 scripts/validate.py
```

## Deploy or run a scan manually

The repository's `.github/workflows/daily-scan.yml` collects data, validates it, commits snapshots, uploads only `site/`, and deploys to GitHub Pages. Set repository **Settings → Pages → Source → GitHub Actions**. Under **Actions → Daily scan & publish → Run workflow**, start a manual scan. The workflow also runs on changes pushed to `main` (except README/tests-only edits).

Actions must have permission to write repository contents; branch protection can prevent snapshot commits. Scheduled Actions can be delayed or disabled by GitHub; review Actions after prolonged inactivity or a failure. Daily scan notifications follow the repository owner's GitHub notification settings.

## Source documentation

- TradingView API availability: https://www.tradingview.com/support/solutions/43000474413-i-need-access-to-your-api-in-order-to-get-data-or-indicator-values/
- SEC data and fair access: https://www.sec.gov/about/webmaster-frequently-asked-questions
- DART API: https://opendart.fss.or.kr/guide/main.do
- GitHub Pages workflows: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- Scheduled workflow behavior: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule

Use upstream data subject to its applicable terms and licensing. This project does not grant redistribution rights to third-party market data.

Industry source: https://www.tradingview.com/support/solutions/43000724300-sector-industry/

The bubble radar uses the pinned Apache ECharts 6.0.0 distribution, served locally from `site/vendor/echarts/` with its LICENSE and NOTICE. Official scatter documentation: https://echarts.apache.org/handbook/en/how-to/chart-types/scatter/basic-scatter/
