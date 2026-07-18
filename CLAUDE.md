# CLAUDE.md

This file provides development guidance for the Pine Script indicators in this repository.

## Project overview

The product is a two-overlay Pine Script v6 suite for TradingView:

- `ict_price_delivery.pine` - imbalances, opening/settlement gaps, FVG residency, HTF candles, selected-HTF FVGs, and gap grading.
- `ict_liquidity_context.pine` - sessions, liquidity, sweeps, structure, SMT, Weekly Power 3, Economic Calendar, Playbook Guard, PDA, Setup Score, and Dashboard.

`merged_indicator.pine` is a legacy comparison source. Its compiled form exceeded TradingView's token ceiling and it is no longer the shipping installation target. Do not add new product functionality only to the monolith.

There is no build system, package manager, local Pine compiler, or automated test framework. Each shipping file is pasted directly into TradingView's Pine Editor.

## Development workflow

1. Identify the owning indicator from the boundary below.
2. Edit the owning shipping file; preserve unrelated user changes.
3. Run source-level dependency, delimiter, parallel-array, and drawing-lifecycle checks.
4. Paste the complete file into TradingView Pine Editor and compile it.
5. Add both indicators to one chart for integration and visual regression checks.
6. Recreate or test the alert family owned by the changed script.

## Hard limits

TradingView compiles Pine into IL and limits each indicator to roughly 100K compiled tokens. Source lines and characters are not a reliable measurement. Keep substantial headroom in both files.

Each script also has an independent maximum of 500 boxes, 500 lines, and 500 labels as declared in `indicator()`. Features must prune their own arrays. Optional quartile grades use two extra line IDs per graded zone and must remain behind the global grade budget.

Section toggles reduce runtime work but do not remove used feature code from the compiled script. Token-heavy functionality belongs in the correct companion indicator instead of being disabled in an overgrown monolith.

## Ownership boundary

### Price Delivery + Gaps

Keep these together in `ict_price_delivery.pine`:

- Volume Imbalances, GAPs, normal FVGs, Liquidity Voids, Implied FVGs, Inverse FVGs, and VI Anchor.
- `GradeLines` and the full 25/50/75 lifecycle.
- NWOG, NDOG ETH, Settlement → ETH, Settlement → RTH, their settings/types, and their request calls.
- HTF candle rendering and traces.
- Fit-live HTF compaction must retain at least four candles when projected FVG detection is enabled (two for raw VI), preserving one completed projected FVG across the next rollover even if that slightly exceeds the requested projection span.
- Selected-HTF FVG overlay.
- Formation/mitigation webhooks and all Delivery alertconditions.

### Sessions + Liquidity Context

Keep these together in `ict_liquidity_context.pine`:

- Full Hourly/Midnight Open and separator state, including `ho_midPrices`.
- Killzones and Session Highs/Lows.
- Sweep engine, EQH/EQL, Wick Reversal, and BOS/CHoCH.
- PDH/PDL, PWH/PWL, and PMH/PML history.
- SMT, PDA Scanner, Setup Score, heartbeat, and Dashboard.
- Weekly Power 3, Economic Calendar, and the calendar-backed Playbook Guard/manual weekly thesis.
- Sweep/structure/SMT/context webhooks and alertconditions.

Do not move only part of the Hourly Open engine to Delivery. Dashboard gap-bias fallback reads `ho_midPrices`. Setup and Dashboard otherwise have no dependency on Delivery's FVG/NWOG/HTF arrays.

## Shared-code rule

Pine indicators cannot inherit from one another or share live arrays, objects, drawings, inputs, or persistent state. A third indicator cannot be a runtime core.

Only small stateless helpers such as `_wh_json` and `f_get_line_style` are intentionally duplicated. Do not duplicate stateful detectors, request pipelines, drawing arrays, or webhook drivers. If shared code grows materially, consider a repository-side generator or a published Pine library after accounting for its publication/versioning constraints.

## Quartile grading invariants

- `GradeLines` owns `q25`, `ce`, and `q75` line references plus the normal-FVG residency counter; keeping that state on the existing owner avoids a third parallel array.
- The existing CE toggle controls whether the zone has a 50% line; 25%/75% grades require that CE line.
- `gradeQuartiles` enables only the optional lines. `gradeMaxZones` caps active quartile owners across all Delivery gap families.
- `f_gradeNew` must enforce both the FIFO cap and the live `line.all` safety guard; `f_gradePinnedNew` reserves that same capped budget for selected-HTF zones ahead of generic lower-timeframe churn.
- Evicting quartiles must mutate the owning `GradeLines` object so its CE remains valid.
- `f_gradeSync` must follow both edges of moving projected boxes plus any right-edge extension or Rebalance geometry change.
- Normal-to-inverse conversion transfers the same `GradeLines` object, refreshes its FIFO age, and must not leave duplicate CE/quartile lines.
- Chart Implied FVG boxes and their `_buifvgce`/`_beifvgce` arrays are parallel and must be inserted, pruned, and indexed together.
- NWOG/NDOG and settlement gaps store grading in `GapBox.grade`; `reset()` must delete it before the box is discarded.
- NWOG/NDOG rendering updates geometry only; it must not continuously reacquire evicted quartiles and starve later FVG families.
- Projected HTF-candle FVGs store grading in `Imbalance.grade`; raw projected volume imbalances remain box-only.
- Selected-HTF zones store pinned grading in `MtfFvgZone.grade`; deletion and inverse color conversion must update the whole grade.
- VI Anchor changes the owning FVG geometry, so it automatically changes its 25/50/75 prices; it is not a separate drawing family.

Supported graded families are GAP, FVG/LV, implied/inverse/VI-anchored FVG, NWOG, NDOG ETH, Settlement → ETH/RTH, projected HTF-candle FVG, and selected-HTF normal/implied/inverse FVG.

## Context invariants

- `SweepState` is shared by session levels, PD/PW/PM levels, EQ pools, and Wick Reversal.
- `AlertFlags` are per-bar values; do not make them `var`.
- Mitigation touch flags in Delivery are also per-bar values; adding `var` latches alerts forever.
- Resolve pending BOS/CHoCH breaks before ingesting fresh pivots.
- Daily dealing-range tracking must run when any of Liquidity, PDA Scanner, Setup, or Dashboard needs it.
- Dashboard remains read-only and does not draw or signal trades.
- Playbook Guard safety reads a raw calendar copy before display currency/impact/timezone filtering; missing feed data must remain fail-closed as `CALENDAR UNAVAILABLE`.
- The manual weekly thesis is informational. Its TGIF projection owns at most one box, resets weekly, and updates rather than recreates that box through Friday.

## Drawing and array patterns

- Prefer create-once/update-via-setters for persistent drawings.
- Prune capped arrays by deleting the shifted object's drawings before discarding it.
- Keep paired arrays synchronized on every push, shift, pop, remove, and normal-to-inverse transfer.
- Use `barstate.isconfirmed` around mitigation and confirmation state changes unless existing behavior intentionally requires live updates.
- Account for both default and user-maximized settings when adding drawings.

## Alerts

Delivery owns formation and mitigation alerts. Context owns sweep, structure, SMT, and heartbeat alerts. A complete webhook setup requires one TradingView `Any alert() function call` alert per indicator. Do not recreate the same detector in both scripts, or duplicate events will be emitted.

## Pine conventions

- Pine Script version 6.
- Prefix global helper functions with `f_`; local variables/parameters generally use `_`.
- Use `var` only for state that must persist across bars.
- Minimize `request.security()` calls and preserve gated SMT/selected-HTF requests.
- Follow the existing compact input and tab-indentation style.
- Preserve UTF-8 circled input-group labels and MPL-2.0 attribution.
