# Market Structure (BOS / CHoCH) — Design Spec

**Date:** 2026-06-03
**Status:** Approved design — ready for implementation
**Target:** `merged_indicator.pine` (Pine v6, single file)
**Branch:** `claude/market-structure-bos-choch`

---

## 1. Goal

The indicator maps *where* liquidity/imbalances sit but has **no trend awareness**. Add swing **Market Structure**: detect **BOS** (Break of Structure = continuation) and **CHoCH** (Change of Character = first counter-trend break = reversal) on the chart timeframe, and — critically — **distinguish a real break from a false break / Turtle Soup**.

## 2. The core idea (answers "how do you know it's not a false break")

A swing-level test resolves into exactly one outcome because the trigger conditions are mutually exclusive on a single bar:

- **BOS / CHoCH** needs a **close beyond** the swing: `close > swingHigh` (or `close < swingLow`), **and the break must HOLD** (price does not close back inside within `struct_holdBars`).
- **Turtle Soup / sweep** needs a **wick beyond + close back inside**: `high > swingHigh AND close < swingHigh` — already handled by the existing `SweepState` engine (and EQH/EQL, which sweeps the same pivots).
- **Failed break / trap** = close beyond but closes back inside within the hold window → **not a BOS** (suppressed in v1).

`close > lvl` and `(high > lvl AND close < lvl)` can never both be true on one bar, so a swing can **never** show both a BOS and a TS mark. The partition is structural, not heuristic. Decision: we do **not** run a second sweep pass on structure swings (would duplicate EQH/EQL) — the close-break trigger alone guarantees the partition; reversals are covered by the existing Sweeps/EQHL features.

## 3. Decisions (locked)

- **Break rule:** close/body break (standard), confirmed on `barstate.isconfirmed` → no repaint.
- **Draw:** breaks only — a line at the broken swing + a small `BOS`/`CHoCH` label + a tracked trend state. No HH/HL/LH/LL swing tags in v1.
- **Pivot length:** dedicated `struct_pivotLen` (own input, default 5) with its own two unconditional `ta.pivothigh/low` calls — decoupled from EQH/EQL so sensitivity/lag is tunable independently.
- **No sweep-side, no trap drawing, no session filter** in v1 (YAGNI / token budget).
- **Gated `ENABLE_STRUCTURE`, default OFF** (token ceiling, like `ENABLE_EQHL`/`ENABLE_PDA_SCANNER`).

## 4. Data model

```pine
type BosState
	int   phase      = 0     // 0 idle, 1 candidate (close broke, awaiting hold), 2 confirmed, 3 trap
	int   breakBar   = na
	float breakLevel = na
```

Swing levels and trend are plain persistent globals (no UDT needed — they're only read/written in the driver):

```pine
var float structLastHigh = na, var int structHighBar = na, var bool structHighResolved = false
var float structLastLow  = na, var int structLowBar  = na, var bool structLowResolved  = false
var int   struct_trend   = 0    // 0 uninit, 1 bull, -1 bear
var BosState bosH = BosState.new()
var BosState bosL = BosState.new()
var array<line>  struct_lines  = array.new<line>()
var array<label> struct_labels = array.new<label>()
```

## 5. Hold-check state machine `f_bosTick`

Mirror of `f_sweepTick`, comparisons **inverted** (break must HOLD, not reverse). Phase-1 block first (matching the fixed sweep engine), so a same-bar resolution can't double-process. Returns `2` on confirm, `3` on trap, else `0`.

```pine
f_bosTick(BosState st, float lvl, bool isHigh, int holdBars) =>
	int _out = 0
	if not na(lvl) and barstate.isconfirmed
		if st.phase == 1
			bool _backInside = isHigh ? (close < st.breakLevel) : (close > st.breakLevel)
			if _backInside
				st.phase := 3
				_out := 3
			else if bar_index - st.breakBar >= holdBars
				st.phase := 2
				_out := 2
		if st.phase == 0
			bool _closeBreak = isHigh ? (close > lvl) : (close < lvl)
			if _closeBreak
				st.phase := 1
				st.breakBar := bar_index
				st.breakLevel := lvl
	_out
```

## 6. BOS vs CHoCH classification

Trend flips **only on a confirmed CHoCH**, at confirm time (end of hold window) — a trapped break never flips trend.

| Trend | Confirmed close-break | Result | Trend after |
|---|---|---|---|
| bull (+1) | above swing high | **BOS** | bull |
| bull (+1) | below swing low | **CHoCH** | → bear |
| bear (−1) | below swing low | **BOS** | bear |
| bear (−1) | above swing high | **CHoCH** | → bull |
| 0 (bootstrap) | either | **BOS** (seed trend to break dir) | bull/bear |

## 7. Per-bar driver (after the EQH/EQL driver)

`_structPh`/`_structPl` are computed **unconditionally** (Pine `ta.*` consistency), next to the EQHL pivots; the gated block consumes them.

```pine
float _structPh = ta.pivothigh(struct_pivotLen, struct_pivotLen)
float _structPl = ta.pivotlow(struct_pivotLen, struct_pivotLen)
if ENABLE_STRUCTURE
	if not na(_structPh)
		structLastHigh := _structPh, structHighBar := bar_index - struct_pivotLen, structHighResolved := false, bosH := BosState.new()
	if not na(_structPl)
		structLastLow := _structPl, structLowBar := bar_index - struct_pivotLen, structLowResolved := false, bosL := BosState.new()
	if not na(structLastHigh) and not structHighResolved
		int _r = f_bosTick(bosH, structLastHigh, true, struct_holdBars)
		if _r == 2
			f_structDrawBreak(structLastHigh, structHighBar, struct_trend == -1, true)
			struct_trend := 1
			structHighResolved := true
		else if _r == 3
			structHighResolved := true
	if not na(structLastLow) and not structLowResolved
		int _r = f_bosTick(bosL, structLastLow, false, struct_holdBars)
		if _r == 2
			f_structDrawBreak(structLastLow, structLowBar, struct_trend == 1, false)
			struct_trend := -1
			structLowResolved := true
		else if _r == 3
			structLowResolved := true
```

`structHighResolved/structLowResolved` are the single-shot guard (one label per swing); a new pivot re-arms the side. Same-bar break is caught: ingest (step 1) then test (step 3) run on the same confirmed bar.

## 8. Drawing helper `f_structDrawBreak`

Create-once (each break is a fixed historical event — no per-bar update), pruned to `struct_maxBreaks`. Reuses `f_get_line_style`, `_ho_getSize`, `_wh_json`, `wh_enable`, the `unshift/pop/delete` prune idiom.

```pine
f_structDrawBreak(float lvl, int swingBar, bool isChoch, bool isUp) =>
	color _clr = isUp ? struct_bullColor : struct_bearColor
	line _ln = line.new(swingBar, lvl, bar_index, lvl, color=_clr, style=f_get_line_style(struct_lineStyle), width=1)
	label _lb = label.new(bar_index, lvl, isChoch ? "CHoCH" : "BOS", style=isUp ? label.style_label_up : label.style_label_down, color=color.new(_clr, 20), textcolor=color.white, size=_ho_getSize(struct_labelSize))
	struct_lines.unshift(_ln)
	struct_labels.unshift(_lb)
	while struct_lines.size() > struct_maxBreaks
		line.delete(struct_lines.pop())
	while struct_labels.size() > struct_maxBreaks
		label.delete(struct_labels.pop())
	if wh_enable and wh_structure
		alert(_wh_json((isChoch ? "CHoCH " : "BOS ") + (isUp ? "BSL" : "SSL"), lvl, lvl), alert.freq_once_per_bar)
```

## 9. Inputs

- ⓪: `ENABLE_STRUCTURE = input.bool(false, "Enable Market Structure (BOS/CHoCH)", group="⓪ Section Toggles")` — after `ENABLE_EQHL`.
- ㉑: `wh_structure = input.bool(true, "Structure Alerts", group="㉑ Webhook Alerts", ...)` — after `wh_sweeps`.
- New group **"㉔ Market Structure"**: `struct_pivotLen` (5, 2–50), `struct_holdBars` (2, 1–5), `struct_bullColor`, `struct_bearColor`, `struct_lineStyle`, `struct_labelSize`, `struct_maxBreaks` (15, 1–40).

## 10. Insertion points (anchor text)

- **Toggle** after `var bool ENABLE_EQHL=input.bool(false, "Enable Equal Highs/Lows", ...)`.
- **wh_structure** after `var bool wh_sweeps=input.bool(true, "Sweep Alerts", ...)`.
- **Inputs + `BosState` + `f_bosTick` + `f_structDrawBreak` + the `var` globals** as one block before `type LiqPool` (after the `eqhl_color` input line) — all deps (`f_get_line_style`, `_ho_getSize`, `_wh_json`, `wh_enable`) already defined above.
- **`_structPh`/`_structPl` + the `if ENABLE_STRUCTURE` driver** immediately after the EQH/EQL driver's `f_eqhlProcess(eqlPools, false)` line (global scope, sibling `if`).

## 11. Repaint, budget, limitations

- **Repaint-safe:** all transitions under `barstate.isconfirmed`; pivots confirmed (`ta.pivot*` non-na only after `struct_pivotLen` closed bars); break line/label created once at confirm and never moved.
- **Lag (known):** a BOS/CHoCH finalizes `struct_pivotLen` + `struct_holdBars` bars after the actual swing-break (the *line* anchors retroactively to the true swing bar; the *label/alert* is delayed). Tunable via the two inputs.
- **Simplified model (known):** tracks only the most-recent swing high/low (internal structure); can mis-time in fast impulsive moves and ping-pong in chop. Acceptable for v1; multi-swing tracking is a future enhancement.
- **Drawing budget:** `struct_maxBreaks` (15) × (1 line + 1 label) = 30 drawings, pruned, against the shared 500 cap.
- **Token budget:** 1 small UDT + 2 functions + ~8 inputs + 2 unconditional `ta.*` + driver. **Verify compiled-token headroom on-chart** (the script is near the ~100K ceiling); if tight, trim inputs. OFF by default → zero per-bar cost when disabled.

## 12. Verification (manual — TradingView only)

1. OFF → no ㉔ drawings, no behavior change, compiles clean, token count acceptable.
2. CHoCH: in a down-leg, a held close above the prior swing high prints **CHoCH** and flips trend bull; the next higher-high break prints **BOS**. Mirror for up→down.
3. False-break partition: a bar that wicks above a swing but closes back below shows **no BOS** (and TS via Sweeps/EQHL if enabled); a held close-break shows **BOS** and no TS on that swing.
4. Trap: a close-break that closes back inside within `struct_holdBars` prints **no** label and does **not** flip trend.
5. No repaint: a fresh BOS/CHoCH stays put on reload/bar-replay (appears only after the hold window).
6. One label per swing (resolved guard); prune cap holds; webhook fires once per break with `wh_enable`+`wh_structure`.
