# Pine Script v6 - ICT Indicator Suite

The indicator is delivered as two Pine Script v6 overlays. The original combined script exceeded TradingView's compiled-token ceiling, so the feature graph was divided at a dependency-safe boundary. Add both overlays to the same chart for the complete toolset.

## Shipping indicators

| File | Purpose |
|---|---|
| `ict_price_delivery.pine` | Chart and selected-HTF FVGs, implied/inverse FVGs, VI anchoring, liquidity voids, GAPs, NWOG/NDOG, HTF candles, and optional 25/50/75 gap grading |
| `ict_liquidity_context.pine` | Hourly/Midnight and weekly opens, Weekly Power 3, killzones, session and higher-period liquidity, sweeps, EQH/EQL, Wick Reversal, BOS/CHoCH, SMT, Economic Calendar, PDA Scanner, Setup Score, and Dashboard |

`merged_indicator.pine` remains a legacy comparison/reference file. It is not the installation target because its compiled form is over TradingView's token limit.

## Gap grading

The Delivery indicator preserves each existing 50% Consequent Encroachment line and adds:

- `25/75% Grades`: enables the two optional quartile lines.
- `Max Graded`: caps the combined number of zones that may own 25% and 75% lines.

Quartiles are supported for:

- True GAP and GAP + Inefficiency
- Normal FVG and Liquidity Void
- Implied and Inverse FVG
- VI-anchored FVG geometry
- NWOG, NDOG ETH, and NDOG RTH
- Projected HTF-candle FVG zones, including the 15-minute candle set
- Selected-HTF normal, implied, and inverse FVG zones

Selected-HTF normal FVGs have independent bullish and bearish colour inputs in the HTF FVG Overlay group. Implied and inverse selected-HTF zones continue to use their dedicated FVG colours.

The 25%/75% lines copy the owning zone's CE color, width, style, and coordinates. They extend, rebalance, change mitigation color, transfer into inverse FVGs, and retire with the same zone. Inverse conversion refreshes the same grade owner at the newest end of the queue. A priority-aware FIFO protects selected-HTF grades from lower-timeframe churn while the live line-count guard protects the 500-line drawing budget; a generic zone whose optional quartiles are evicted keeps its 50% line.

## Installation

1. Open TradingView and create a new Pine indicator.
2. Paste `ict_price_delivery.pine`, save it, and add it to the chart.
3. Create a second Pine indicator.
4. Paste `ict_liquidity_context.pine`, save it, and add it to the same chart.
5. Configure the two settings panels as required.

Both declarations use `overlay=true` and `behind_chart=true`. If visual stacking matters, adjust their order in TradingView's Object Tree.

## Weekly Power 3 and Economic Calendar

Both additions live in the Context indicator and default off under `⓪ Section Toggles`:

- `Enable Weekly Power 3` adds a bounded weekly-open history, live and optional historical weekly high/low lines, weekday labels, and the Tuesday-London-to-Wednesday-New-York best-odds window. Its drawing history is capped by the `Weeks` input and it runs on intraday through daily charts.
- `Enable Economic Calendar` adds impact/currency filters, current-day or current-week tables, event labels, and event lines. Calendar drawings are kept in module-owned arrays and pruned independently, so they cannot delete liquidity, structure, open, or Weekly Power 3 drawings.

The calendar is supported from 30-second through daily charts and depends on the pinned `toodegrees` Forex Factory utility/decoder libraries plus their nine Pine Seed feeds. On index symbols where automatic currency detection is empty, disable `Automatic currencies` and select `USD`. If the Calendar and Dashboard are enabled together, choose distinct table positions. The calendar has its own line/label cap, but all modules still share TradingView's 500-object limits.

## Alerts

Alerts are divided by ownership:

- Delivery: FVG/VI/GAP formation and mitigation events.
- Context: sweep, BOS/CHoCH, SMT, and context-heartbeat events.

For webhook coverage, create one TradingView `Any alert() function call` alert for each indicator. Existing alerts created from the monolith must be recreated.

## Development and verification

There is no local Pine compiler or automated test framework. The workflow is:

1. Edit the relevant shipping `.pine` file.
2. Run source-level dependency and drawing-lifecycle checks.
3. Paste into TradingView Pine Editor and confirm compilation.
4. Add both scripts to a chart and compare visuals and alerts.

Each script has its own token and drawing budgets. Do not duplicate stateful engines across the boundary, and do not attempt to use a third indicator as a shared runtime core; Pine indicators cannot share arrays, drawings, or persistent state. Only tiny stateless helpers are duplicated.

## Credits

Built on work by:

- Vulnerable_human_x - ICT Gaps, Volume & Price Imbalances
- fadizeidan - NWOG/NDOG and HTF Candles
- @malk1903 - MTF FVG x2 [MK] overlay concept
- Infinity_Trading_ - Weekly Power 3 concept
- toodegrees - Live Economic Calendar and pinned Forex Factory libraries

Licence: Mozilla Public License 2.0
