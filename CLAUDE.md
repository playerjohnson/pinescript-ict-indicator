# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Single-file Pine Script v6 indicator (`merged_indicator.pine`, ~3,200 lines) for TradingView. Merges multiple ICT (Inner Circle Trader) trading tools into one overlay. There is no build system, package manager, or test framework — the script is pasted directly into TradingView's Pine Editor.

## Development Workflow

1. Edit `merged_indicator.pine`
2. Paste into TradingView Pine Editor → click "Add to Chart"
3. Verify visually on a chart (no automated tests exist)

## Critical Constraint: TradingView Token Limit

TradingView compiles Pine Script into tokens and enforces a hard limit (~100K). This script is near that ceiling. Every change must consider compiled token cost:
- Prefer reusing existing functions over creating new ones
- Avoid redundant variable declarations (e.g., `float x = na` when Pine already defaults to `na`)
- Consolidate repetitive code into shared functions
- The PDA Scanner (`ENABLE_PDA_SCANNER`) defaults to `false` specifically to save tokens

## Architecture

### Master Toggle Pattern
All features are gated by `ENABLE_*` booleans (group `⓪ Section Toggles`). Disabled sections incur zero per-bar cost. New features **must** follow this pattern. `ENABLE_SWEEPS` (Liquidity Sweeps) defaults on; `ENABLE_EQHL` (Equal Highs/Lows pivot layer) defaults off to save tokens.

### Input Groups
Numbered `⓪` through `㉗` with Unicode circled numbers. Each feature section has its own group. When adding inputs, use the next available group number and follow the existing `inline=` pattern for compact layout.

### Custom Types (UDTs)
- `Candle`, `CandleSet`, `CandleSettings`, `HTFSettings` — HTF candle tracking
- `Imbalance`, `Trace` — HTF imbalance/trace structures
- `NWOGHelper`, `NWOGSettings`, `Gap`, `OpenGap`, `GapBox` — NWOG/NDOG structures
- `SweepState` — shared sweep-engine state (session H/L, PD/PW/PM levels, EQ pools)
- `LiqPool` — Equal-High/Low liquidity pool
- `BosState` — market-structure pending-break state
- `SHLevel` — archived session / PD-PW-PM level (price, `mitigated`, embedded `SweepState`)
- `SmtPair`, `SmtBreak` — SMT pivot-divergence / level-break state (per symbol × scale × side)
- `DealingRange` — PDA Scanner previous-period range (EQ/25%/75% lines)
- `DashAcc` — Dashboard nearest-liquidity accumulator (mutated by reference)
- `AlertFlags` — per-bar (non-`var`) sweep/structure confirm flags feeding the native alertconditions

(`OrderBlock`, `RejBlock`, `SwingPt`, `PendingBrk`, `PDZone` were removed with their sections in `d2d22ac` for token budget.)

### Section Layout (top to bottom)
1. **Inputs & toggles** (~lines 1–341; the sweeps ㉒, structure ㉔, SMT ㉗, and dashboard ㉖ sections declare their own inputs inline further down)
2. **Hourly Open & Separator** — Midnight opens, hourly lines
3. **Imbalances** — FVG, VI, GAP, Implied FVG, Inverse FVG, Liquidity Voids (12 unified loops). The `…(±) Mitigation` alertconditions (end of this section) read plain (non-`var`) per-bar touch flags — adding `var` back would latch them true forever
4. **NWOG/NDOG** — New Week/Day Opening Gap with `request.security()`
5. **HTF Candles** — 6 configurable timeframe levels with traces
6. **Killzones** — Session highlight `bgcolor` (Asian, London, NY AM/PM, Silver Bullet)
7. **Liquidity Sweeps** — shared sweep engine (`SweepState`, `f_sweepTick`, `f_sweepMark`); confirmed Turtle Soup detection on session H/L + PD/PW/PM, gated by `ENABLE_SWEEPS` (default on). Equal-High/Low pools (`LiqPool`, `ta.pivothigh/low`) gated by `ENABLE_EQHL` (default off) reuse the same engine. Confirms also set per-bar `AlertFlags` fields feeding native `Sweep BSL/SSL` alertconditions (declared after the ㉔ driver). Detection, webhooks, and alertconditions run even when a level class's display toggle is off — only the TS marker draw (`f_sweepMark`'s `draw` param) and line recolor are display-gated; the master toggles still gate everything
8. **Market Structure** — BOS/CHoCH on swing pivots (own `struct_pivotLen`/`ta.pivothigh/low`), gated by `ENABLE_STRUCTURE` (default off). `BosState`/`f_bosTick` is a mirror of the sweep engine with **inverted** comparisons: a BOS is a CLOSE beyond a swing that HOLDS `struct_holdBars` bars (else trap, suppressed); trend flips only on a confirmed CHoCH. The close-break trigger (`close>lvl`) and the sweep's wick-reject (`high>lvl & close<lvl`) are mutually exclusive on one bar, so a swing is never both a BOS and a Turtle Soup — false breaks are excluded structurally. Driver (after ⑳, ~line 2710) resolves pending breaks **before** ingesting new pivots; a trap re-arms the level. Known limitations: the hold window is a *delayed close-break* (it rejects immediate reversals, not a break that holds the window then reverses — no displacement/ATR buffer yet); and it tracks only the most-recent swing per side (internal structure), so it can mis-time in fast moves. Confirmed breaks set `AlertFlags` for native `BOS Bull/Bear` and `CHoCH Bull/Bear` alertconditions
9. **Session Highs/Lows** — Previous session range tracking (`SHLevel`, `_sh_archive`, `_sh_processHist`). Close-through mitigation **and** sweep detection both run even when a session's display toggle is off (the Dashboard and alerts read them); only drawing is gated
10. **Liquidity Levels** — PDH/PDL, PWH/PWL, PMH/PML as **multi-level history** (gated `ENABLE_LIQUIDITY`). Each completed day/week/month H/L is archived on rollover into `lq_hist{Day,Week,Month}{H,L}` arrays of `SHLevel` (reused from ⑲), pruned by a per-TF count cap (`lq_maxDaily/Weekly/Monthly`) **and** a `lq_lookbackDays` (60) age cutoff (`f_lqPrune`). Rendered by `_lq_processHist` (sibling of `_sh_processHist`): shared sweep/Turtle-Soup detection + **close-through mitigation** (a confirmed `close` beyond the level greys it to dotted `lq_mitColor`, hidden by `lq_showMit`). Weekly/monthly are collected via the existing `request.security("W"/"M", […, time[1]])` calls (no new security call) and render on all chart TFs; **daily uses the NY-midnight intraday tracker, so daily history is intraday-only** (blank on non-intraday charts). `_prevMidDayHi/Lo` and `_secWeek/Month` globals are preserved for the PDA Scanner; the Dashboard reads the `lq_hist*` arrays directly (all levels, filtered for close-through mitigation and confirmed sweeps). Mitigation state is maintained even when a class's display toggle is off. Known limits: shared 500-drawing cap (caps tunable); age-prune is evaluated at archive time, so a level can outlive the window by up to one period (the newest level of each class always survives the age-prune, so short `lq_lookbackDays` can't empty the weekly/monthly arrays).
11. **SMT Divergences** — gated `ENABLE_SMT` (default off), group ㉗. Two detectors sharing this file's by-reference-UDT idiom (one state instance per comparison-symbol × scale × side, like `SweepState`/`f_sweepTick`): `SmtPair`/`f_smtPair` pairs the chart symbol's `ta.pivothigh/low` with the comparison symbol's within a sync window at two scales (`smt_lenShort`/`smt_lenLong`), and `SmtBreak`/`f_smtBreak` fires when one symbol wick-breaks its own long-scale pivot while the other holds for `sweep_confirmBars` confirmed closes. Up to two correlated symbols (`smt_sym1`/`smt_sym2`, defaults ES1!/YM1!) fetched via one gated `request.security` each (`[high, low, syminfo.ticker]`). The detectors draw the divergence line/label; the `if ENABLE_SMT` driver owns all global writes (line/label arrays, per-bar `smtBullFired`/`smtBearFired` flags for the `alertcondition` pair, pruning to `smt_maxDiv`). Chart pivots are computed unconditionally (matching ㉓/㉔); comparison data is gated for zero cost when disabled. A live readout (per-symbol divergence counts + last-divergence time) folds into the ㉖ Dashboard. Known limits: pivot pairing tolerates de-sync only up to the sync window; the break detector is blind to levels younger than the long pivot length; correlation is the user's responsibility.
12. **PD Array Scanner** — `f_pdaScanner()`, previous-period dealing ranges (`DealingRange`): EQ/25%/75% lines only, no confluence scoring
13. **Dashboard** — gated `ENABLE_DASHBOARD` (default off) corner `table.new` (group ㉖); read-only confluence readout (premium/discount vs dealing-range EQ from `_pdaHi/_pdaLo`, structure trend + last BOS/CHoCH via `struct_lastBreak`, nearest untapped liquidity ↑/↓ via a `DashAcc` accumulator mutated by `f_dashNear`/`f_dashShArr`, active killzone via `f_inSession`). The Liq scan walks **every** archived `SHLevel` of the ⑲ session arrays and the ⑳ `lq_hist*` arrays, skipping levels that are close-through mitigated **or** sweep-confirmed (phase 2); EQH/EQL pools are filtered by sweep phase only (pools have no close-through mitigation concept). Populated on `barstate.islast` only; each row degrades to `—` when its source module is off. Note: Pine tuple destructuring `[a,b]=f()` *declares* (not reassigns), so the liquidity scan threads state via a by-reference UDT, not tuples. EQH/EQL pairs pivots within tolerance via a 6-deep recent-pivot ring buffer (`_eqhRecent`/`_eqlRecent`), so it catches equal highs/lows separated by an intervening raid. Known limitation: in a strong trend the pairwise tolerance can emit a few extra pools (pool span can drift beyond `tol`). Sweep detection deliberately still fires on already-mitigated session levels (re-tests), which can show both `⚡TS` and `[Mitigated]`

### Key Patterns
- **Create-once, update-via-setters**: Drawings are created once and updated with `set_*()` methods, not deleted and recreated each bar
- **Array pruning**: Arrays have max-size caps. When exceeded, oldest entries are `shift()`ed and their drawings deleted. Bull+bear share one array → cap is typically `maxBoxes * 2`
- **Paired arrays**: Some imbalance sections use parallel arrays (e.g., boxes + closing-edge lines) that must stay in sync during insert/remove operations
- **Webhook alerts**: `_wh_json()` helper generates JSON payloads. Formation and mitigation alerts are gated by `wh_enable`, `wh_formations`, `wh_mitigations`

### Drawing Limits
TradingView caps at 500 each of boxes, lines, and labels. The indicator declares these maximums. When adding features that create drawings, account for consumption by other sections.

## Pine Script Conventions in This Codebase

- Prefix `f_` for global functions, `_` for local variables/parameters
- `var` keyword for persistent state (initialized once, survives across bars)
- `barstate.isconfirmed` guards on mitigation/extend loops to avoid repainting
- `request.security()` calls are minimized (8 always-on; +2 gated behind `ENABLE_SMT` when both SMT comparison symbols are enabled) due to performance cost
- Tabs for indentation, compact spacing around `=` in input declarations
