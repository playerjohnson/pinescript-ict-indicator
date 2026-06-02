# Liquidity Sweep / Turtle Soup Detection — Design Spec

**Date:** 2026-06-01
**Status:** Approved design — ready for implementation planning
**Target file:** `merged_indicator.pine` (Pine Script v6, single-file TradingView indicator)
**Approach:** B — shared sweep engine (one state machine + one renderer, fed by every level type)

---

## 1. Goal

The indicator draws ICT liquidity pools (session highs/lows, PDH/PDL/PWH/PWL/PMH/PML) but only ever detects **mitigation** (a *close-through* of a level). It never detects a **sweep** — the wick-through-then-reject "stop raid" that, when followed by a reversal, is the **Turtle Soup** entry and the single most actionable ICT trigger.

Add **confirmed Turtle Soup** detection: mark and alert a level when price wicks past it, closes back, and then reverses within a configurable window — across session H/L, PD/PW/PM levels, and (gated, off by default) Equal-High/Low pools.

## 2. Scope

**In scope**
- Sweep + reversal-confirmation state machine, written once and reused.
- Wiring into Session Highs/Lows and PDH/PDL/PWH/PWL/PMH/PML.
- Equal-High/Low (EQH/EQL) pool detection via swing pivots, **off by default** (token-heavy).
- Visual marks (reuse existing level line + one marker label) and webhook alerts.

**Out of scope**
- Changing or replacing the existing **mitigation** (close-through) logic — sweep is an independent state.
- The backlog items (prune-helper refactor, BOS/CHoCH, dashboard). EQH/EQL here reuses a minimal pivot read only; it is **not** the full structure module.

**Phasing (single spec, two phases)**
- **Phase 1** — engine + Session H/L + PD/PW/PM. Self-contained, shippable, token-low.
- **Phase 2** — EQH/EQL pivot layer + sweeps on those pools. Isolated, gated `ENABLE_EQHL` (default **off**), token-medium. Can be deferred or dropped under token pressure without affecting Phase 1.

## 3. Background — current code anchors (verified 2026-06-01)

| Element | Line(s) | Note |
|---|---|---|
| `⓪ Section Toggles` (`ENABLE_*`) | 21–28 | add `ENABLE_SWEEPS`; Phase 2 adds `ENABLE_EQHL` |
| `㉑ Webhook Alerts` (`wh_formations`, `wh_mitigations`) | 31–32 | add `wh_sweeps` |
| `_wh_json(event, high, low)` | 34 | reuse for sweep alerts (consumes **0** output slots) |
| `type SHLevel` | 2120–2126 | add a `SweepState` field |
| `_sh_archive(...)` | 2131–2142 | also delete the swept marker when a level is popped |
| `_sh_processHist(...)` | 2144–2184 | per-level loop with the existing `_hit`/`mitigated` close-through detection (line 2157–2163) — add the sweep tick here |
| Session H/L driver `if ENABLE_SESSION_HL and timeframe.isintraday` | 2247 | calls `_sh_processHist` ×12 at 2339–2350 |
| `_lq_draw(...)` | 2360–2380 | per-call-site `var line`; add `var SweepState` for high + low |
| Liquidity driver `if ENABLE_LIQUIDITY` | 2407–2410 | PDH/PDL, PWH/PWL, PMH/PML |

**Mitigation vs sweep (the core distinction):** existing mitigation = `_isHigh ? close > price : close < price` (a *close beyond* the level = acceptance). A **sweep** = the wick pierces but the close returns: `high > level AND close < level` (high) / `low < level AND close > level` (low). They are different events and tracked independently; the sweep engine does not modify the mitigation branch.

## 4. Data model

```pine
type SweepState
    int   phase        = 0    // 0 untested, 1 swept-pending, 2 confirmed (Turtle Soup)
    float levelPrice   = na   // level being watched; used to auto-reset when the value rolls
    int   sweepBar     = na   // bar_index of the wick-reject bar
    float confirmLevel = na   // sweep bar's opposite extreme = reversal/displacement threshold
    int   sweepTime    = na
    label marker       = na   // one created-once/updated marker label
```

`SHLevel` gains one field: `SweepState sweep = na` (created lazily on first tick). For the Liquidity module, each `_lq_draw` call holds `var SweepState _swH` and `var SweepState _swL`.

## 5. The shared engine

### 5.1 `f_sweepTick(SweepState st, float lvl, bool isHigh, int confirmBars) → bool justConfirmed`

Logic + cleanup of its own stale marker only (no other drawing). Runs only on confirmed bars. Pine passes the object by reference, so field mutations persist.

```
if not na(lvl):
    if na(st.levelPrice) or st.levelPrice != lvl:        # value rolled (new PDH/PWH/...) → re-arm
        label.delete(st.marker); st.marker := na         # safe on na; clears a prior confirmed mark
        st.phase := 0; st.levelPrice := lvl; st.sweepBar := na
    if barstate.isconfirmed:
        if st.phase == 0:                                 # look for bare sweep
            bareSweep = isHigh ? (high > lvl and close < lvl) : (low < lvl and close > lvl)
            if bareSweep:
                st.phase := 1; st.sweepBar := bar_index; st.sweepTime := time
                st.confirmLevel := isHigh ? low : high    # whole-candle rejection threshold
        else if st.phase == 1:                            # await reversal/displacement
            confirmed = isHigh ? (close < st.confirmLevel) : (close > st.confirmLevel)
            if confirmed:
                st.phase := 2; justConfirmed := true
            else if bar_index - st.sweepBar >= confirmBars:
                st.phase := 0                             # expired → re-arm (no permanent mark)
return justConfirmed
```

**Confirmation rule (default, tunable):** a confirmed close beyond the sweep bar's *opposite extreme* (close below the sweep candle's low for a high-sweep; above its high for a low-sweep) = displacement/rejection. Window = `confirmBars` confirmed bars (default 2), inclusive of bars `sweepBar+1 … sweepBar+confirmBars`.

### 5.2 `f_sweepMark(SweepState st, string name, bool isHigh)`

Called when `justConfirmed`. Handles **marker + alert only** — it does **not** set the level line's color:
- If `sweep_showMarker`: create-once/update one marker label at `(st.sweepBar, st.confirmLevel)` with text `isHigh ? "TS↓" : "TS↑"`, `sweep_markerColor`/`sweep_markerSize`.
- Fire alert (see §7).

**Why the line recolor lives in the host, not here:** `_sh_processHist` recomputes and re-applies its line color *every bar* (line 2176). If this helper set the line color, the host would clobber it on the next bar. So each host module owns its line color and folds the sweep state into its own color decision (§6) — this also keeps "swept" visually distinct from "mitigated" through one authoritative code path per module.

## 6. Wiring

**Session H/L** — inside `_sh_processHist`, on `ENABLE_SWEEPS` and after the `na(_lvl.price)` guard (line 2150): lazily create `_lvl.sweep` (`if na(_lvl.sweep): _lvl.sweep := SweepState.new()`), then `bool _c = f_sweepTick(_lvl.sweep, _lvl.price, _isHigh, sweep_confirmBars)`; `if _c: f_sweepMark(_lvl.sweep, _name, _isHigh)`. **Line/label recolor:** extend the existing color ternaries (lines 2166–2172) with a swept branch — `bool _swept = not na(_lvl.sweep) and _lvl.sweep.phase == 2`; `_lineClr = _swept ? sweep_lineColor : (_lvl.mitigated ? sh_mitColor : _color)` (mirror for `_lblClr`; optionally append `" ⚡TS"` to `_txt`). The existing `line.set_color(_lvl.ln, _lineClr)` at 2176 then paints the swept color correctly every bar. Extend `_sh_archive` to delete the marker on pop, guarded: `if not na(_old.sweep)\n    label.delete(_old.sweep.marker)`.

**PD/PW/PM** — inside `_lq_draw`, add `var SweepState _swH` / `var SweepState _swL`. On `ENABLE_SWEEPS`, after the line/label maintenance: tick both sides (`f_sweepTick(_swH, _hi, true, ...)`, `f_sweepTick(_swL, _lo, false, ...)`), `f_sweepMark` on confirm. **Line recolor:** the current code only sets line color on *creation* (2365–2366); add a per-bar `line.set_color(_lnH, _swH.phase == 2 ? sweep_lineColor : _hClr)` (mirror for low) so the swept color persists. The value-roll reset in `f_sweepTick` re-arms when PDH/PWH/etc. changes; delete the prior marker on that reset (`if not na(st.marker): label.delete(st.marker)` inside the reset branch).

**EQH/EQL (Phase 2, `ENABLE_EQHL` default off)** — new block: `ta.pivothigh(eqhl_pivotLen, eqhl_pivotLen)` / `ta.pivotlow(...)`; cluster a new pivot with the last pivot of the same side when within `eqhl_tolerance` (derived from `ta.sma(high - low, eqhl_pivotLen)` so no ATR dependency); register each pool as a line + label (pruned to `eqhl_maxPools` per side) plus its own `SweepState`, then run it through the same `f_sweepTick`/`f_sweepRender`.

## 7. Alerts

On `justConfirmed`, gated by `wh_enable and wh_sweeps`:
```
alert(_wh_json("SWEEP " + name + (isHigh ? " BSL" : " SSL"), level, level), alert.freq_once_per_bar)
```
Event examples: `"Asia High Swept BSL"`, `"PDL Swept SSL"`. Uses the existing webhook helper → **0 new output slots**. `freq_once_per_bar` matches the codebase's mitigation-alert convention. No `alertcondition()` is added (keeps the output budget untouched); can be revisited if non-webhook alerts are wanted.

## 8. Inputs

- `⓪`: `ENABLE_SWEEPS=input.bool(true, ...)`; Phase 2: `ENABLE_EQHL=input.bool(false, ...)`.
- New group **"㉒ Liquidity Sweeps"**: `sweep_confirmBars` (int, default 2, 1–5), `sweep_lineColor` (color), `sweep_showMarker` (bool, default true), `sweep_markerColor`, `sweep_markerSize` (string size, default tiny).
- `㉑ Webhook Alerts`: `wh_sweeps=input.bool(true, "Sweep Alerts", inline="wh1", ...)`.
- Phase 2 group **"㉓ Equal Highs/Lows"**: `ENABLE_EQHL`, `eqhl_pivotLen` (int, default 5), `eqhl_tolerance` mult (float, default ~0.1 of `sma(high-low,len)`), `eqhl_maxPools` (int, default 10), `eqhl_color`.

## 9. Repaint safety

All transitions and marker creation occur on `barstate.isconfirmed`. Confirmation references the **historical** sweep bar's stored `confirmLevel` (fixed once set). The forming real-time bar shows nothing until it closes. EQH/EQL pivots confirm `eqhl_pivotLen` bars after the pivot — inherent, documented lag, not a repaint.

## 10. Drawing & token budget

- **Phase 1:** 0 new lines (recolors the existing level line); ≤ 1 marker label per confirmed sweep. Session-H/L markers bounded by `sh_historyCount` (deleted on archive); liquidity adds ≤ 6. Trivial vs the 500-label cap. **0 new outputs** (alert() consumes none).
- **Phase 2 (off):** EQH/EQL lines + labels pruned to `eqhl_maxPools × 2` per side; counts only when enabled.
- **Tokens:** engine written once = low. EQH/EQL pivot/cluster logic is the main cost (medium), gated off by default. The backlog `f_prunePair()` refactor would reclaim budget to offset Phase 2.

## 11. Edge cases & error handling

- Skip `na`/empty: `na(price)` guards; `array.size()>0` before loops.
- Outright close-through (no wick reject) is **not** a sweep — engine stays untested; existing mitigation handles it. A level may later be both swept and mitigated; states coexist.
- PD/PW/PM value rolls while pending → `f_sweepTick` resets that level's state to untested and the old marker is deleted.
- `confirmBars` counts confirmed bars only (no intrabar counting).
- One bar sweeping several levels → each `SweepState` advances independently.
- Marker lifecycle: session-H/L markers deleted in `_sh_archive`; liquidity markers deleted on roll-reset — no unbounded growth.

## 12. Verification (manual — no automated tests; TradingView only)

1. Paste into Pine Editor → compiles clean; output count unchanged (~23).
2. Intraday chart, Session H/L + Sweeps on: a known Asia-high raid marks **TS↓ only after** the reversal bar — never on the wick bar alone, and not at all if no reversal follows within `confirmBars`.
3. Reload / scroll back → confirmed marks stay put (no repaint); unconfirmed sweeps leave no mark.
4. Liquidity on: a PDL raid marks **TS↑**; state resets the next day with the new PDH/PDL.
5. `wh_enable` + `wh_sweeps`, alert on "Any alert() function call" → fires once per confirmed sweep with correct JSON (`"PDL Swept SSL"`, price).
6. `ENABLE_SWEEPS` off → zero sweep cost/drawings. `ENABLE_EQHL` on → pools appear (pruned to cap); off → zero cost.
7. All modules + many sessions/levels on → total drawing count stays < 500.

## 13. Docs

Update `CLAUDE.md` section layout to list the new "Liquidity Sweeps" module and `ENABLE_SWEEPS`/`ENABLE_EQHL` toggles (and, while there, correct the stale "7 `request.security` calls" → 8 noted by the idea-catalog critic).
