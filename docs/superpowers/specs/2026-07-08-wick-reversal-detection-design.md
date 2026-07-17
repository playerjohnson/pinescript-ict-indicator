# Wick Reversal (Bar-A / Bar-B) Detection — Design Spec

**Date:** 2026-07-08
**Status:** Approved design — ready for implementation planning
**Target file:** `merged_indicator.pine` (Pine Script v6, single-file TradingView indicator)
**Approach:** A — single current-pivot-per-side state, reusing the ㉒ sweep engine and the ㉓ pivot calc

---

## 1. Goal

The user circled a recurring reversal shape on-chart (screenshots reviewed interactively): a swing bar (**Bar A**) prints a new local high/low with a wick, a later bar (**Bar B**) trades back into that wick's zone and **closes** there — between Bar A's body edge and its extreme, without making a new extreme itself — and price then actually breaks Bar A's *opposite* edge, confirming the reversal.

This is a distinct pattern from the existing Turtle Soup / Liquidity Sweep engine (`f_sweepTick`): that engine requires the **same** bar to wick past a *pre-existing named level* and have its own close snap fully back past it. Here there is no pre-existing level — Bar A's extreme is created by the swing itself — and the qualifying event is a **different, later** bar's close landing inside Bar A's wick (not fully back past the level).

Add detection for this shape, on **any local swing pivot** (not just named/archived levels), firing both directions (bearish at swing highs, bullish at swing lows — mirrors).

## 2. Scope

**In scope**
- One new state machine (`f_wickTick`) mirroring the shape of `f_sweepTick` but with the Bar-A/Bar-B comparisons this pattern actually needs.
- Wiring against the freshest swing high/low only (single current-pivot-per-side, like ㉔ Market Structure's `structLastHigh`/`structLastLow` — not a historical array).
- Reuse of `SweepState`/`f_sweepMark` for marker draw, alertcondition, webhook, and ㉘ Setup Score freshness stamping.
- One new master toggle.

**Out of scope**
- A dedicated alertcondition/webhook event distinct from `Sweep BSL`/`Sweep SSL` (reuses the existing ones — see §7 known limitation).
- A historical archive of every past swing (Approach C, rejected — see below).
- Wiring into the existing EQH/EQL "equal pools" array (Approach B, rejected — see below).
- Any new drawn line/box for the watched wick zone — marker-only, consistent with how other sweep sources already render.

**Rejected approaches**
- **B — piggyback on EQH/EQL pools:** `f_eqhlAdd` only registers a pool when a fresh pivot lands within tolerance of a *recent* same-side pivot (genuine "equal highs/lows"). Most circled instances were one-off swings that never pair up, so this would miss most of the pattern.
- **C — full historical swing archive** (like ⑳ Liquidity Levels' `lq_hist*`): would also catch reversals against older, non-most-recent swings, but costs an array + pruning + per-bar history loop for a case the reviewed charts didn't show a need for — over-engineered against the token budget.

## 3. Background — current code anchors (verified 2026-07-08)

| Element | Line(s) | Note |
|---|---|---|
| `⓪ Section Toggles` (`ENABLE_*`) | 21–34 | add `ENABLE_WICK_REV` |
| `type SweepState` | 2143–2149 | add one field: `float bodyEdge = na` |
| `f_sweepTick(...)` | 2173–2197 | pattern reference only — **not called** by this feature (different comparisons, see §5) |
| `f_sweepMark(...)` | 2201–2216 | reused **verbatim** for marker/alert/webhook/Setup-Score stamping |
| `var int sweep_confirmBars` | 2137 | reused as the Bar-B → confirm window (no new input) |
| `var bool sweep_showMarker` / `sweep_markerColor` / `sweep_markerSize` | 2139–2141 | reused as-is (checked inside `f_sweepMark`) |
| `var int eqhl_pivotLen` | 2219 | reused as the swing-sensitivity input (no new input) |
| `float _eqhlPh = ta.pivothigh(eqhl_pivotLen, eqhl_pivotLen)` / `_eqhlPl` | 2725–2726 | computed **unconditionally** already (Pine `ta.*` consistency rule) — reused directly, **zero new `ta.*` calls** |
| ㉓ EQH/EQL driver block | 2719–2748 | new ㉙ driver is inserted immediately after this block (line 2749), before the `㉔ Market Structure driver` comment at 2750 |

## 4. Data model

`SweepState` (existing, §"Custom Types" in CLAUDE.md) gains one field:

```pine
type SweepState
	int   phase        = 0
	float levelPrice   = na
	int   sweepBar     = na
	float confirmLevel = na
	int   sweepTime    = na
	label marker       = na
	float bodyEdge     = na   // NEW: Bar A's body edge (the near side of its wick zone)
```

Two new persistent instances (module-level, mirroring `structLastHigh`/`bosH` in ㉔):

```pine
var SweepState wickRevH = SweepState.new()
var SweepState wickRevL = SweepState.new()
```

No array, no pool, no pruning — this tracks only the freshest swing per side, same idiom as Market Structure's pending-break state.

## 5. The new engine

### 5.1 `f_wickTick(SweepState st, float extreme, float bodyEdge, float oppositeEdge, bool isHigh, int confirmBars) → bool justConfirmed`

Deliberately **not** a call into `f_sweepTick` — the comparisons differ in a way that matters (see below) — but it mirrors its two-phase shape (bare condition → timed confirm), same convention already used by `BosState`/`f_bosTick` as "a mirror of the sweep engine with different comparisons."

```
if not na(extreme):                                  # a fresh pivot just confirmed → re-arm unconditionally
	label.delete(st.marker); st.marker := na
	st.phase := 0
	st.levelPrice := extreme                          # Bar A's extreme (the wick tip)
	st.bodyEdge := bodyEdge                           # Bar A's body edge (wick zone near side)
	st.confirmLevel := oppositeEdge                   # Bar A's OPPOSITE edge — fixed now, not derived later
	st.sweepBar := na
if barstate.isconfirmed and not na(st.levelPrice):
	if st.phase == 1:                                 # awaiting Bar-A opposite-edge break
		confirmed = isHigh ? (close < st.confirmLevel) : (close > st.confirmLevel)
		if confirmed:
			st.phase := 2; justConfirmed := true
		else if bar_index - st.sweepBar >= confirmBars:
			st.phase := 0                              # expired → re-arm, same Bar A stays live
	if st.phase == 0:                                 # look for Bar B: a close inside Bar A's wick zone
		wickClose = isHigh ? (close > st.bodyEdge and close <= st.levelPrice)
		              : (close < st.bodyEdge and close >= st.levelPrice)
		if wickClose:
			st.phase := 1; st.sweepBar := bar_index; st.sweepTime := time
return justConfirmed
```

**Why this is not a call to `f_sweepTick`:** that function derives `confirmLevel` from the *bare-sweep bar's own* opposite extreme, at the moment the bare condition fires — because in Turtle Soup, the bare-sweep bar and the level-relative bar are the same bar. Here, Bar A (the level source) and Bar B (the bare-condition bar) are **different bars**, so `confirmLevel` (Bar A's opposite edge) must be captured at **re-arm time**, before Bar B ever appears. This is the one substantive divergence from the existing engine's shape, and will be called out in a code comment (matching the file's existing convention of documenting mirror-engine divergences, e.g. the `BosState` comment already in the file).

**Confirmation rule:** identical window semantics to the existing engine — a confirmed close beyond Bar A's opposite edge within `confirmBars` (reusing `sweep_confirmBars`, default 2) confirms; otherwise phase resets to 0 and Bar A stays live for a possible later Bar B (the pivot itself is not discarded until a genuinely new pivot re-arms it).

### 5.2 Driver (inserted after line 2748, before the ㉔ Market Structure driver comment)

```pine
// ═══════════ ㉙ Wick Reversal ═══════════
// Bar A (a fresh swing pivot) prints a wick; Bar B later closes back inside that wick zone
// (between A's body edge and its extreme, without exceeding it); confirmed when price closes
// past A's opposite edge. Reuses ㉓'s pivot calc + ㉒'s SweepState/f_sweepMark; f_wickTick is
// its own mirror of f_sweepTick — confirmLevel is captured from Bar A at re-arm time, not
// derived from the bare-condition bar (Bar A and Bar B are different bars here).
var SweepState wickRevH = SweepState.new()
var SweepState wickRevL = SweepState.new()
if ENABLE_WICK_REV
	if f_wickTick(wickRevH, _eqhlPh, math.max(close[eqhl_pivotLen], open[eqhl_pivotLen]), low[eqhl_pivotLen], true, sweep_confirmBars)
		f_sweepMark(wickRevH, "WR", true, true)
	if f_wickTick(wickRevL, _eqhlPl, math.min(close[eqhl_pivotLen], open[eqhl_pivotLen]), high[eqhl_pivotLen], false, sweep_confirmBars)
		f_sweepMark(wickRevL, "WR", false, true)
```

`close[eqhl_pivotLen]`/`open[eqhl_pivotLen]`/`low[eqhl_pivotLen]`/`high[eqhl_pivotLen]` read the OHLC of the bar that **is** the pivot (it confirms exactly `eqhl_pivotLen` bars late, so at the confirming bar, the pivot bar sits `eqhl_pivotLen` bars back) — plain history-index reads, no new `request.security`/`ta.*` calls. These are only meaningful (non-na) on the bars `_eqhlPh`/`_eqhlPl` are non-na; `f_wickTick`'s re-arm branch only reads them `if not na(extreme)`, so their value on other bars is irrelevant.

## 6. Wiring

Fully self-contained — no changes to any other module's code. Placed physically right after the ㉓ EQH/EQL driver (§3) since it consumes `_eqhlPh`/`_eqhlPl` computed there; documented in CLAUDE.md as an extension of the "Liquidity Sweeps" section (the same section EQH/EQL itself is documented under, despite EQH/EQL having its own ㉓ input group).

## 7. Alerts

Reuses `f_sweepMark` verbatim:
- Marker: same `TS↑`/`TS↓` label style, `sweep_markerColor`/`sweep_markerSize`, gated by `sweep_showMarker` (checked inside `f_sweepMark`).
- `alertFlags.swpBsl`/`swpSsl` set → fires the existing native `Sweep BSL`/`Sweep SSL` `alertcondition()` (no new alertcondition, no new output slot).
- Webhook (gated `wh_enable and wh_sweeps`): `"SWEEP WR BSL"` / `"SWEEP WR SSL"` (the `name="WR"` argument distinguishes it in the JSON payload only).
- `setupState.swpBslBar`/`swpSslBar` stamped → automatically feeds the ㉘ Setup Score's "fresh same-side sweep" point, no changes needed to ㉘.

**Known limitation (consistent with existing EQH/EQL sweeps):** the native alertcondition and on-chart marker are indistinguishable from a named-level (session/PD/PW/PM) sweep — a user watching the generic "Sweep BSL" alert can't tell which reference produced it without checking the webhook JSON's `event` field.

## 8. Inputs

- `⓪ Section Toggles`: `var bool ENABLE_WICK_REV=input.bool(false, "Enable Wick Reversal", group="⓪ Section Toggles", tooltip="Marks a reversal when a bar closes back inside a recent swing's wick (not a new extreme), then price breaks the swing's opposite edge. Swing sensitivity uses the Equal Highs/Lows pivot length (㉓); confirm window uses the Liquidity Sweeps confirm-bars setting (㉒) — both apply even if those sections are disabled.")` (matches the existing `var bool ENABLE_*=input.bool(...)` style at lines 21–34).

No other new inputs — everything else is reused (`eqhl_pivotLen`, `sweep_confirmBars`, `sweep_showMarker`, `sweep_markerColor`, `sweep_markerSize`, `sweep_lineColor` unused here since there's no line to recolor).

## 9. Repaint safety

All transitions occur on `barstate.isconfirmed`. The pivot itself (`_eqhlPh`/`_eqhlPl`) is inherently confirmed `eqhl_pivotLen` bars late — same documented lag as EQH/EQL and Market Structure, not a new repaint concern. `confirmLevel` is fixed at re-arm time and never recomputed, so a confirmed mark never moves once drawn.

## 10. Drawing & token budget

- 0 new lines/boxes. ≤ 1 marker label per confirmed reversal per side (2 `SweepState` instances total — bounded, no array, no pruning needed).
- 0 new output slots (alert() consumes none; no new alertcondition).
- **Estimated compiled-token cost:** ~150–200 tokens — one bool input, one struct field, one ~20-line function, an ~8-line driver block. No new `ta.*`/`request.security` calls.

## 11. Edge cases & error handling

- `na` extremes (chart hasn't formed `eqhl_pivotLen` bars yet, or the pivot lookback is temporarily na): re-arm branch guarded by `not na(extreme)`; phase-check branch guarded by `not na(st.levelPrice)`.
- A bar with zero wick at the pivot (`bodyEdge == levelPrice`, e.g. a marubozu pivot): the wick-zone condition can never be satisfied (empty range) — correctly produces no signal.
- A new pivot arrives while phase is 1 (awaiting confirm) or 2 (already confirmed): unconditional re-arm on `not na(extreme)` discards the pending/confirmed state and starts fresh against the new Bar A — any already-fired confirm has already run its one-time marker/alert, so nothing is lost.
- Bar B's close exactly equal to Bar A's extreme or body edge: inclusive at the extreme (`<=`/`>=`), exclusive at the body edge (`>`/`<`) — a close exactly on the body edge is the body itself, not the wick, so excluded.
- Both `wickRevH` and `wickRevL` tick independently every bar — a bar can be mid-confirmation on one side while a fresh pivot re-arms the other.

## 12. Verification (manual — no automated tests; TradingView only)

1. Paste into Pine Editor → compiles clean; output/alertcondition count unchanged (reuses existing `Sweep BSL`/`Sweep SSL`).
2. `ENABLE_WICK_REV` on, `ENABLE_SWEEPS` on: reproduce one of the reviewed chart examples (a swing high where a later bar's close stays under the swing high but above its body, followed by a break of the swing's low) → a `TS↓` marker appears **only after** the confirming break, never on Bar B alone.
3. Bar B's close never occurs (price just chops or makes a new high instead) → no marker; a genuinely new pivot re-arms silently.
4. `ENABLE_WICK_REV` off → zero added cost/drawings (driver block short-circuits entirely).
5. `ENABLE_SETUP` on alongside `ENABLE_WICK_REV` → a confirmed wick reversal bumps the ㉘ Setup Score's sweep-freshness point on that side.
6. `wh_enable` + `wh_sweeps` on, alert on "Any alert() function call" → fires once per confirmed reversal with `"SWEEP WR BSL"`/`"SWEEP WR SSL"` in the JSON.
7. Reload / scroll back → confirmed marks stay put (no repaint).

## 13. Docs

Update `CLAUDE.md`'s section-7 ("Liquidity Sweeps") description to mention the new Wick Reversal detector and `ENABLE_WICK_REV` toggle, and add `SweepState.bodyEdge` to the "Custom Types (UDTs)" list note for `SweepState`.
