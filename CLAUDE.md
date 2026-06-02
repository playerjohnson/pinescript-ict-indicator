# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Single-file Pine Script v6 indicator (`merged_indicator.pine`, ~3,500 lines) for TradingView. Merges multiple ICT (Inner Circle Trader) trading tools into one overlay. There is no build system, package manager, or test framework — the script is pasted directly into TradingView's Pine Editor.

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
Numbered `⓪` through `㉕` with Unicode circled numbers. Each feature section has its own group. When adding inputs, use the next available group number and follow the existing `inline=` pattern for compact layout.

### Custom Types (UDTs)
- `OrderBlock` — Used by Order Blocks, Breaker Blocks, and Mitigation Blocks
- `RejBlock` — Rejection Blocks (box + optional trigger line)
- `SwingPt` — Swing point data (price, bar, body, wick)
- `PendingBrk` — Unconfirmed breaker awaiting price confirmation
- `PDZone` — PD Array zone for confluence scanner scoring
- `Candle`, `CandleSet`, `CandleSettings` — HTF candle tracking
- `Imbalance`, `Trace` — HTF imbalance/trace structures
- `NWOGHelper`, `NWOGSettings`, `Gap`, `OpenGap`, `GapBox` — NWOG/NDOG structures

### Section Layout (top to bottom)
1. **Inputs & toggles** (~lines 1–50)
2. **Hourly Open & Separator** — Midnight opens, hourly lines
3. **Order Blocks** — Current TF + 3 MTF layers, `f_obScan()`, `f_obManage()`, `f_mtfObTick()`
4. **Imbalances** — FVG, VI, GAP, Implied FVG, Inverse FVG, Liquidity Voids (12 unified loops)
5. **NWOG/NDOG** — New Week/Day Opening Gap with `request.security()`
6. **HTF Candles** — 6 configurable timeframe levels with traces
7. **Killzones** — Session highlight boxes (Asian, London, NY, Silver Bullet)
8. **Session Highs/Lows** — Previous session range tracking
9. **Liquidity Levels** — PDH/PDL, PWH/PWL, PMH/PML
9b. **Liquidity Sweeps** — shared sweep engine (`SweepState`, `f_sweepTick`, `f_sweepMark`); confirmed Turtle Soup detection on session H/L + PD/PW/PM, gated by `ENABLE_SWEEPS` (default on). Equal-High/Low pools (`LiqPool`, `ta.pivothigh/low`) gated by `ENABLE_EQHL` (default off) reuse the same engine.
10. **Rejection Blocks** — `f_rbDetect()`, `f_rbManage()`, pivot + wick% validation
11. **Breaker & Mitigation Blocks** — `f_breakerMitProcess()`, swing-based detection
12. **PD Array Scanner** — `f_pdaScanner()`, confluence scoring across all formations
13. **Alert conditions & warnings**

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
- `request.security()` calls are minimized (currently 8 total) due to performance cost
- Tabs for indentation, compact spacing around `=` in input declarations
