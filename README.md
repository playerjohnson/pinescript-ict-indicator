# Pine Script v6 - ICT Indicator Suite

The indicator is delivered as two Pine Script v6 overlays. The original combined script exceeded TradingView's compiled-token ceiling, so the feature graph was divided at a dependency-safe boundary. Add both overlays to the same chart for the complete toolset.

## Shipping indicators

| File | Purpose |
|---|---|
| `ict_price_delivery.pine` | Chart and selected-HTF FVGs, optional FVG residency, implied/inverse FVGs, VI anchoring, liquidity voids, GAPs, NWOG/NDOG and settlement gaps, HTF candles, and optional 25/50/75 gap grading |
| `ict_liquidity_context.pine` | Hourly/Midnight and weekly opens, Weekly Power 3, Playbook Guard, killzones, session and higher-period liquidity, sweeps, EQH/EQL, Wick Reversal, BOS/CHoCH, SMT, Market Maker Model Tracker and Candidate Map, Economic Calendar, PDA Scanner, Setup Score, and Dashboard |

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
- NWOG, NDOG ETH, Settlement → ETH, and Settlement → RTH
- Projected HTF-candle FVG zones, including the 15-minute candle set
- Selected-HTF normal, implied, and inverse FVG zones

Selected-HTF normal FVGs have independent bullish and bearish colour inputs in the HTF FVG Overlay group. Implied and inverse selected-HTF zones continue to use their dedicated FVG colours.

The 25%/75% lines copy the owning zone's CE color, width, style, and coordinates. They extend, rebalance, change mitigation color, transfer into inverse FVGs, and retire with the same zone. Inverse conversion refreshes the same grade owner at the newest end of the queue. A priority-aware FIFO protects selected-HTF grades from lower-timeframe churn while the live line-count guard protects the 500-line drawing budget; a generic zone whose optional quartiles are evicted keeps its 50% line.

## HTF projected candles

The Delivery indicator defaults to the nearest three valid higher-timeframe sets with four candles each. Padding, candle spacing, and inter-timeframe spacing are honored in both fit and manual modes. Fit mode drops farther HTF sets before reducing the history needed by projected FVG/VI detection, and both modes keep every projected drawing within a 490-bar future bound.

Custom daily candles can roll at New York midnight, 08:30, or 09:30 even when the chart timeframe does not open a bar on the exact minute. On historical bars that span a custom boundary, TradingView exposes only the aggregate chart-bar OHLC, so that first custom candle is approximate unless the chart timeframe aligns with the boundary.

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

## Playbook Guard and delivery quality

The Context indicator's `Enable Playbook Guard` toggle defaults off. When enabled it reuses an unfiltered copy of the existing calendar feed for named USD CPI, PPI, FOMC, NFP, and Fed-speaker lockouts; calendar display filters cannot disable the safety state. The Dashboard adds Guard and manual weekly-thesis rows, marks Setup as blocked during lockouts or missing calendar data, closes the Monday probe at 10:10 New York time, and can maintain one live Friday 20–30% TGIF retracement box after the declared weekly draw is touched. Enabling the Guard without calendar visuals still activates the same nine Pine Seed requests because the risk state depends on them.

The Delivery indicator keeps the former 16:14-to-18:00 gap as `Settlement → ETH` and adds a separate, default-off `Settlement → RTH` gap from the prior 16:14 New York settlement close to the next 09:30 open. Both use the existing OpenGap rendering, cap, CE, and optional 25/75% grading lifecycle.

`FVG Residency` is also default off. For normal chart FVGs and selected-HTF normal FVGs it annotates consecutive confirmed candle-body overlaps as 1 Conviction, 2–3 Normal, 4–5 Hesitation, and above 5 Failed/Stale. The counter resets when the body leaves the zone and creates no additional drawing objects or alerts.

## Market Maker Model Tracker and Candidate Map

`Enable Market Maker Model Tracker` lives in the Context indicator and defaults off. It requires Liquidity Sweeps, Market Structure, and at least one external-liquidity source: Session Highs/Lows, Liquidity Levels, or EQH/EQL. Selecting `SMT = Required` also requires SMT; selecting `Require Killzone` requires an enabled intraday killzone.

The mirrored MMBM/MMSM trackers progress on confirmed bars through Raid → Shift → FVG → Retrace Ready → Expansion → Target, with invalid and expired terminal states. Inputs control Touch/CE/Full FVG retrace, SMT Off/Optional/Required, real in-range premium/discount location, final-raid-extreme killzone membership, and timeout. The opposing-liquidity target is selected beyond the full confirmed raid path and frozen when the candidate arms.

The Phase 1 tracker reuses existing sweep, structure, SMT, killzone, and liquidity state and applies Delivery's exact normal-FVG predicate locally; it adds no drawings or `request.security()` calls. The Dashboard gains one `MM Model` row. MMBM and MMSM each expose Shift, Retrace Ready, Target, and Invalid native alerts plus optional Model webhooks. Playbook Guard suppresses only Retrace Ready notifications, and the context heartbeat includes both model phases and frozen targets.

`Enable Market Maker Model Map` is the separate, default-off Phase 2 overlay and requires the Phase 1 tracker. The user manually anchors an original consolidation (start, end, high, and low), selects MMBM or MMSM and labels the view Primary or Nested. It follows only that direction's latest/live model: Stage 1 is the exact tracked displacement FVG, while Stage 2 is one of up to three bounded opposing-candle candidates found before expansion. Stage 2 supports wick/body geometry and Touch/CE/Full retrace criteria.

The map is deliberately non-authoritative: every stage is labelled `CANDIDATE`, Primary/Nested is a manual label, and it does not classify order blocks or choose a fractal model. It owns at most three boxes (OC, Stage 1, and Stage 2), adds no `request.security()` calls, alerts, webhooks, or Setup Score points, and keeps terminal drawings frozen. OC traversal can complete only after the confirmed shift; model history is not retained.

This is a context classifier, not an automatic trade signal. Setup Score remains the existing five-point `L x/5 · S y/5` checklist; MM state does not add a sixth point or change its denominator.

## Alerts

Alerts are divided by ownership:

- Delivery: FVG/VI/GAP formation and mitigation events.
- Context: sweep, BOS/CHoCH, SMT, MMBM/MMSM Shift, Retrace Ready, Target and Invalid, and context-heartbeat events.

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
