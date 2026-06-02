# Liquidity Sweep / Turtle Soup Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add confirmed Turtle Soup (liquidity-sweep + reversal) detection, marks, and alerts across session highs/lows, PD/PW/PM levels, and (gated, off by default) Equal-High/Low pools.

**Architecture:** One shared sweep state machine (`SweepState` UDT + `f_sweepTick`) and one marker/alert helper (`f_sweepMark`), fed by every level type. Each host module owns its own line color and reads the sweep phase. All detection is on `barstate.isconfirmed` (no repaint).

**Tech Stack:** Pine Script v6, single file `merged_indicator.pine`. No build system, no package manager, **no automated test framework** — TradingView only.

---

## ⚠️ How to "test" in this codebase (read before executing)

There is **no automated test runner**. Pine compiles and runs only inside TradingView. Therefore:

- Every "**Compile check**" step means: copy the entire `merged_indicator.pine` into the TradingView **Pine Editor** → click **Add to Chart** → confirm **no red compile errors**. An automated agent **cannot** do this — it must **pause and ask the human** to paste & confirm.
- Every "**Manual verify**" step is an on-chart visual check (from the spec's §12 checklist). Same constraint: a human performs it.
- Agents executing this plan should: make the edit, do a careful **static self-review** of the diff (Pine syntax, definition-before-use, paired-array sync), then **hand the compile/verify checkpoint to the human** before committing. Commits may proceed once the human confirms compile-clean (or, for low-risk doc/edits, after static review).

**Spec:** `docs/superpowers/specs/2026-06-01-liquidity-sweep-detection-design.md`

---

## File Structure

| File | Responsibility | Changes |
|---|---|---|
| `merged_indicator.pine` | the whole indicator | add toggles (top), one cohesive **sweep-engine block** (UDTs + functions + inputs) inserted just before `type SHLevel` (~line 2120), then wire into `_sh_processHist`, `_lq_draw`, and a new Phase-2 EQH/EQL block after the Liquidity section (~line 2410) |
| `CLAUDE.md` | project guide | note the new module + toggles; correct the stale "7 `request.security`" → 8 |

All line numbers are **pre-insertion approximations** — each Modify step gives the exact **anchor text** to match, so it stays correct as earlier tasks shift line numbers.

---

# Phase 1 — Engine + Session H/L + PD/PW/PM

## Task 1: Master toggles + webhook sub-toggle

**Files:**
- Modify: `merged_indicator.pine` (⓪ toggles ~line 28; ㉑ webhook ~line 32)

- [ ] **Step 1: Add the two master toggles after `ENABLE_PDA_SCANNER`**

Match this anchor:
```pine
var bool ENABLE_PDA_SCANNER=input.bool(false, "Enable PD Array Scanner", group="⓪ Section Toggles")
```
Replace with:
```pine
var bool ENABLE_PDA_SCANNER=input.bool(false, "Enable PD Array Scanner", group="⓪ Section Toggles")
var bool ENABLE_SWEEPS=input.bool(true, "Enable Liquidity Sweeps", group="⓪ Section Toggles")
var bool ENABLE_EQHL=input.bool(false, "Enable Equal Highs/Lows", group="⓪ Section Toggles")
```

- [ ] **Step 2: Add the webhook sub-toggle after `wh_mitigations`**

Match this anchor:
```pine
var bool wh_mitigations=input.bool(true, "Mitigation Alerts", group="㉑ Webhook Alerts", inline="wh1", tooltip="Mitigation events")
```
Replace with:
```pine
var bool wh_mitigations=input.bool(true, "Mitigation Alerts", group="㉑ Webhook Alerts", inline="wh1", tooltip="Mitigation events")
var bool wh_sweeps=input.bool(true, "Sweep Alerts", group="㉑ Webhook Alerts", tooltip="Liquidity sweep / Turtle Soup events")
```

- [ ] **Step 3: Compile check** — paste full file into Pine Editor → Add to Chart. Expected: no errors; two new toggles appear in the ⓪ group, a "Sweep Alerts" box in ㉑.

- [ ] **Step 4: Commit**
```bash
git add merged_indicator.pine
git commit -m "feat(sweeps): add ENABLE_SWEEPS/ENABLE_EQHL + wh_sweeps toggles"
```

---

## Task 2: Sweep-engine block (inputs + SweepState UDT + f_sweepTick + f_sweepMark)

**Files:**
- Modify: `merged_indicator.pine` — insert immediately **before** `type SHLevel` (~line 2120)

**Why here:** `SHLevel` will gain a `SweepState` field (Task 3), so `SweepState` must be defined first; and `_sh_processHist` (~line 2144) calls `f_sweepTick`/`f_sweepMark`, so they must be defined before it. `_wh_json` (line 34), `wh_enable` (line 30), and `wh_sweeps` (Task 1) are all already defined above this point.

- [ ] **Step 1: Insert the engine block before `type SHLevel`**

Match this anchor (the start of the Session H/L section):
```pine
type SHLevel
	float price
```
Replace with:
```pine
// ===== ㉒ Liquidity Sweep engine (shared by Session H/L, PD/PW/PM, EQH/EQL) =====
var int    sweep_confirmBars = input.int(2, "Confirm bars", minval=1, maxval=5, group="㉒ Liquidity Sweeps", inline="sw1", tooltip="A reversal must confirm within this many bars after the wick-reject, or the sweep re-arms.")
var color  sweep_lineColor   = input.color(color.new(#ffd54f, 0), "Swept line", group="㉒ Liquidity Sweeps", inline="sw1")
var bool   sweep_showMarker  = input.bool(true, "Marker", group="㉒ Liquidity Sweeps", inline="sw2")
var color  sweep_markerColor = input.color(color.new(#ffd54f, 0), "", group="㉒ Liquidity Sweeps", inline="sw2")
var string sweep_markerSize  = input.string(size.tiny, "", options=[size.tiny, size.small, size.normal], group="㉒ Liquidity Sweeps", inline="sw2")

type SweepState
	int   phase        = 0
	float levelPrice   = na
	int   sweepBar     = na
	float confirmLevel = na
	int   sweepTime    = na
	label marker       = na

// Advances the sweep state machine for one level on one bar. Returns true on the
// bar a Turtle Soup confirms. Mutates st in place (Pine objects are by-reference).
f_sweepTick(SweepState st, float lvl, bool isHigh, int confirmBars) =>
	bool _justConfirmed = false
	if not na(lvl)
		if na(st.levelPrice) or st.levelPrice != lvl
			label.delete(st.marker)
			st.marker := na
			st.phase := 0
			st.levelPrice := lvl
			st.sweepBar := na
		if barstate.isconfirmed
			if st.phase == 0
				bool _bareSweep = isHigh ? (high > lvl and close < lvl) : (low < lvl and close > lvl)
				if _bareSweep
					st.phase := 1
					st.sweepBar := bar_index
					st.sweepTime := time
					st.confirmLevel := isHigh ? low : high
			else if st.phase == 1
				bool _confirmed = isHigh ? (close < st.confirmLevel) : (close > st.confirmLevel)
				if _confirmed
					st.phase := 2
					_justConfirmed := true
				else if bar_index - st.sweepBar >= confirmBars
					st.phase := 0
	_justConfirmed

// Draws/updates the one marker label and fires the webhook alert. Does NOT recolor
// the level line — each host module owns that (see plan Tasks 4/5).
f_sweepMark(SweepState st, string name, bool isHigh) =>
	if sweep_showMarker
		string _tag = isHigh ? "TS↓" : "TS↑"
		if na(st.marker)
			st.marker := label.new(st.sweepBar, st.levelPrice, _tag, xloc=xloc.bar_index, style=isHigh ? label.style_label_down : label.style_label_up, color=color.new(sweep_markerColor, 20), textcolor=color.white, size=sweep_markerSize)
		else
			label.set_xy(st.marker, st.sweepBar, st.levelPrice)
			label.set_text(st.marker, _tag)
	if wh_enable and wh_sweeps
		alert(_wh_json("SWEEP " + name + (isHigh ? " BSL" : " SSL"), st.levelPrice, st.levelPrice), alert.freq_once_per_bar)

type SHLevel
	float price
```

- [ ] **Step 2: Compile check** — paste full file → Add to Chart. Expected: no errors; a new "㉒ Liquidity Sweeps" input group appears (confirm-bars, colors, marker). No visual change yet (functions unused).

- [ ] **Step 3: Commit**
```bash
git add merged_indicator.pine
git commit -m "feat(sweeps): add SweepState UDT, f_sweepTick state machine, f_sweepMark helper + inputs"
```

---

## Task 3: Add `sweep` field to `SHLevel` + clean up its marker on archive

**Files:**
- Modify: `merged_indicator.pine` — `type SHLevel` and `_sh_archive` (~lines 2120/2131, now shifted down by Task 2)

- [ ] **Step 1: Add the `sweep` field to `SHLevel`**

Match:
```pine
type SHLevel
	float price
	int startBar
	int priceTime
	bool mitigated = false
	line ln = na
	label lbl = na
```
Replace with:
```pine
type SHLevel
	float price
	int startBar
	int priceTime
	bool mitigated = false
	line ln = na
	label lbl = na
	SweepState sweep = na
```

- [ ] **Step 2: Delete the sweep marker when a level is archived/pruned (both loops)**

Match:
```pine
			while array.size(_histH) > sh_historyCount
				SHLevel _old = array.pop(_histH)
				line.delete(_old.ln)
				label.delete(_old.lbl)
			while array.size(_histL) > sh_historyCount
				SHLevel _old = array.pop(_histL)
				line.delete(_old.ln)
				label.delete(_old.lbl)
```
Replace with:
```pine
			while array.size(_histH) > sh_historyCount
				SHLevel _old = array.pop(_histH)
				line.delete(_old.ln)
				label.delete(_old.lbl)
				if not na(_old.sweep)
					label.delete(_old.sweep.marker)
			while array.size(_histL) > sh_historyCount
				SHLevel _old = array.pop(_histL)
				line.delete(_old.ln)
				label.delete(_old.lbl)
				if not na(_old.sweep)
					label.delete(_old.sweep.marker)
```

- [ ] **Step 3: Compile check** — paste → Add to Chart. Expected: no errors; no behavior change yet.

- [ ] **Step 4: Commit**
```bash
git add merged_indicator.pine
git commit -m "feat(sweeps): add SweepState field to SHLevel + archive marker cleanup"
```

---

## Task 4: Wire sweep detection into `_sh_processHist` (session highs/lows)

**Files:**
- Modify: `merged_indicator.pine` — `_sh_processHist` (~line 2144)

- [ ] **Step 1: Run the sweep tick right after the `na(_lvl.price)` guard**

Match:
```pine
				SHLevel _lvl = array.get(_hist, i)
				if na(_lvl.price)
					continue
				if _lvl.mitigated and not sh_showMit
```
Replace with:
```pine
				SHLevel _lvl = array.get(_hist, i)
				if na(_lvl.price)
					continue
				if ENABLE_SWEEPS
					if na(_lvl.sweep)
						_lvl.sweep := SweepState.new()
					if f_sweepTick(_lvl.sweep, _lvl.price, _isHigh, sweep_confirmBars)
						f_sweepMark(_lvl.sweep, _name, _isHigh)
				if _lvl.mitigated and not sh_showMit
```

- [ ] **Step 2: Fold the swept state into the line/label color + label text**

Match:
```pine
				color _lineClr = _lvl.mitigated ? sh_mitColor : _color
				color _lblClr = _lvl.mitigated ? sh_mitLblColor : _color
				int _lw = _lvl.mitigated ? sh_mitLineWidth : sh_lineWidth
				string _mitTxt = _lvl.mitigated ? " [Mitigated]" : ""
				string _txt = _name + " " + _side + str.tostring(_lvl.price, format.mintick) + _sh_fmtTime(_lvl.priceTime) + _mitTxt
```
Replace with:
```pine
				bool _swept = ENABLE_SWEEPS and not na(_lvl.sweep) and _lvl.sweep.phase == 2
				color _lineClr = _swept ? sweep_lineColor : _lvl.mitigated ? sh_mitColor : _color
				color _lblClr = _swept ? sweep_lineColor : _lvl.mitigated ? sh_mitLblColor : _color
				int _lw = _lvl.mitigated ? sh_mitLineWidth : sh_lineWidth
				string _swTxt = _swept ? " ⚡TS" : ""
				string _mitTxt = _lvl.mitigated ? " [Mitigated]" : ""
				string _txt = _name + " " + _side + str.tostring(_lvl.price, format.mintick) + _sh_fmtTime(_lvl.priceTime) + _swTxt + _mitTxt
```

- [ ] **Step 2b: Static self-review** — confirm `line.set_color(_lvl.ln, _lineClr)` (a few lines below, unchanged) now receives the swept color every bar; confirm `_swept` is computed before its first use.

- [ ] **Step 3: Compile check** — paste → Add to Chart on an **intraday** chart with Session Highs/Lows enabled. Expected: no errors.

- [ ] **Step 4: Manual verify (spec §12.2/§12.3)** — find a bar where price wicked above a prior session high then closed back below, and the next ≤2 confirmed bars closed below that wick bar's low. Expected: the session-high line recolors to the swept color, label gains `⚡TS`, and a `TS↓` marker appears — **only after** the reversal bar, never on the wick bar alone. Reload the chart: the mark stays (no repaint); a wick with no follow-through leaves no mark.

- [ ] **Step 5: Commit**
```bash
git add merged_indicator.pine
git commit -m "feat(sweeps): detect Turtle Soup sweeps on session highs/lows"
```

---

## Task 5: Wire sweep detection into `_lq_draw` (PDH/PDL/PWH/PWL/PMH/PML)

**Files:**
- Modify: `merged_indicator.pine` — `_lq_draw` (~line 2360)

- [ ] **Step 1: Add per-call-site sweep state for high + low**

Match:
```pine
_lq_draw(_show, _hi, _lo, _hClr, _lClr, _style, _hName, _lName) =>
	var line _lnH = na, var line _lnL = na
	var label _lbH = na, var label _lbL = na
	if _show and not na(_hi)
```
Replace with:
```pine
_lq_draw(_show, _hi, _lo, _hClr, _lClr, _style, _hName, _lName) =>
	var line _lnH = na, var line _lnL = na
	var label _lbH = na, var label _lbL = na
	var SweepState _swH = SweepState.new()
	var SweepState _swL = SweepState.new()
	if _show and not na(_hi)
```

- [ ] **Step 2: After the line-maintenance branch, tick + mark + recolor the lines**

Match (the end of the line if/else, just before the label block):
```pine
			else
				line.set_x1(_lnH, bar_index - 1), line.set_y1(_lnH, _hi), line.set_x2(_lnH, bar_index + 30), line.set_y2(_lnH, _hi)
				line.set_x1(_lnL, bar_index - 1), line.set_y1(_lnL, _lo), line.set_x2(_lnL, bar_index + 30), line.set_y2(_lnL, _lo)
				_lnL
			if lq_showLabels
```
Replace with:
```pine
			else
				line.set_x1(_lnH, bar_index - 1), line.set_y1(_lnH, _hi), line.set_x2(_lnH, bar_index + 30), line.set_y2(_lnH, _hi)
				line.set_x1(_lnL, bar_index - 1), line.set_y1(_lnL, _lo), line.set_x2(_lnL, bar_index + 30), line.set_y2(_lnL, _lo)
				_lnL
			if ENABLE_SWEEPS
				if f_sweepTick(_swH, _hi, true, sweep_confirmBars)
					f_sweepMark(_swH, _hName, true)
				if f_sweepTick(_swL, _lo, false, sweep_confirmBars)
					f_sweepMark(_swL, _lName, false)
				if not na(_lnH)
					line.set_color(_lnH, _swH.phase == 2 ? sweep_lineColor : _hClr)
				if not na(_lnL)
					line.set_color(_lnL, _swL.phase == 2 ? sweep_lineColor : _lClr)
			if lq_showLabels
```

- [ ] **Step 2b: Static self-review** — `_swH`/`_swL` are `var` so they persist per call site (PDH/PDL, PWH/PWL, PMH/PML get independent instances). The value-roll reset inside `f_sweepTick` re-arms when the daily/weekly/monthly value changes and deletes the prior marker.

- [ ] **Step 3: Compile check** — paste → Add to Chart, intraday, PDH/PDL enabled. Expected: no errors.

- [ ] **Step 4: Manual verify (spec §12.4)** — on a day where price wicks below PDL then reverses up within ≤2 bars: the PDL line recolors swept and a `TS↑` marker appears. Next day, confirm state resets to the new PDL (old mark cleared on the roll).

- [ ] **Step 5: Commit**
```bash
git add merged_indicator.pine
git commit -m "feat(sweeps): detect Turtle Soup sweeps on PD/PW/PM liquidity levels"
```

---

## Task 6: Phase 1 docs + full verification pass

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the module + toggles to the CLAUDE.md section layout and fix the security count**

In `CLAUDE.md`, under "### Section Layout (top to bottom)", add a line after the Liquidity Levels entry:
```markdown
9b. **Liquidity Sweeps** — `f_sweepTick()`/`f_sweepMark()`, shared sweep engine (`SweepState`); confirmed Turtle Soup detection on session H/L + PD/PW/PM levels, gated by `ENABLE_SWEEPS`
```
And under "Master Toggle Pattern", note `ENABLE_SWEEPS` (default on) and `ENABLE_EQHL` (default off). In the "Pine Script Conventions" line that says `request.security()` calls are "currently 7 total", change **7 → 8**.

- [ ] **Step 2: Run the full Phase-1 verification checklist (spec §12.1–§12.6)**

Paste → Add to Chart and confirm each: compiles clean; output count still ~23 (Pine Editor → no new plots); session + liquidity sweeps mark only after confirmation; no repaint on reload; webhook fires once per confirmed sweep with correct JSON (`wh_enable` + `wh_sweeps` on, alert on "Any alert() function call"); `ENABLE_SWEEPS` off → zero marks/cost.

- [ ] **Step 3: Commit**
```bash
git add CLAUDE.md
git commit -m "docs(sweeps): document Liquidity Sweeps module + correct security-call count"
```

---

# Phase 2 — Equal-High/Low pools (gated `ENABLE_EQHL`, default off)

## Task 7: EQH/EQL inputs + `LiqPool` type + helper functions

**Files:**
- Modify: `merged_indicator.pine` — insert into the sweep-engine block, immediately **after** `f_sweepMark` (defined in Task 2) and **before** `type SHLevel`

- [ ] **Step 1: Insert EQH/EQL inputs, type, and functions**

Match (end of `f_sweepMark`, start of SHLevel):
```pine
	if wh_enable and wh_sweeps
		alert(_wh_json("SWEEP " + name + (isHigh ? " BSL" : " SSL"), st.levelPrice, st.levelPrice), alert.freq_once_per_bar)

type SHLevel
	float price
```
Replace with:
```pine
	if wh_enable and wh_sweeps
		alert(_wh_json("SWEEP " + name + (isHigh ? " BSL" : " SSL"), st.levelPrice, st.levelPrice), alert.freq_once_per_bar)

// ===== ㉓ Equal Highs/Lows (resting liquidity pools) =====
var int    eqhl_pivotLen = input.int(5, "Pivot length", minval=2, maxval=50, group="㉓ Equal Highs/Lows", inline="eq1", tooltip="Bars each side for swing pivots; pivots confirm this many bars late.")
var float  eqhl_tolMult  = input.float(0.1, "Tolerance ×range", minval=0.0, maxval=1.0, step=0.05, group="㉓ Equal Highs/Lows", inline="eq1", tooltip="Two pivots are 'equal' if within this fraction of the average bar range.")
var int    eqhl_maxPools = input.int(10, "Max pools/side", minval=1, maxval=50, group="㉓ Equal Highs/Lows", inline="eq2")
var color  eqhl_color    = input.color(color.new(#b39ddb, 0), "Color", group="㉓ Equal Highs/Lows", inline="eq2")

type LiqPool
	float price
	line  ln = na
	label lbl = na
	SweepState sweep = na

// Register a new equal-high/low pool, deduped against the newest existing pool, pruned to cap.
f_eqhlAdd(array<LiqPool> pools, float price, float tol) =>
	bool _dup = false
	if pools.size() > 0
		LiqPool _last = pools.get(0)
		if math.abs(_last.price - price) <= tol
			_dup := true
	if not _dup
		pools.unshift(LiqPool.new(price = price))
		while pools.size() > eqhl_maxPools
			LiqPool _old = pools.pop()
			line.delete(_old.ln)
			label.delete(_old.lbl)
			if not na(_old.sweep)
				label.delete(_old.sweep.marker)

// Draw/update each pool's line+label, run sweep detection through the shared engine.
f_eqhlProcess(array<LiqPool> pools, bool isHigh) =>
	if pools.size() > 0
		for i = 0 to pools.size() - 1
			LiqPool _p = pools.get(i)
			int _x2 = bar_index + 30
			if na(_p.ln)
				_p.ln := line.new(bar_index - 1, _p.price, _x2, _p.price, color=eqhl_color, style=line.style_dashed, width=1)
			line.set_x2(_p.ln, _x2)
			if na(_p.lbl)
				_p.lbl := label.new(_x2, _p.price, isHigh ? "EQH" : "EQL", style=label.style_label_left, color=color.new(color.white, 100), textcolor=eqhl_color, size=size.tiny)
			label.set_x(_p.lbl, _x2)
			if ENABLE_SWEEPS
				if na(_p.sweep)
					_p.sweep := SweepState.new()
				if f_sweepTick(_p.sweep, _p.price, isHigh, sweep_confirmBars)
					f_sweepMark(_p.sweep, isHigh ? "EQH" : "EQL", isHigh)
				line.set_color(_p.ln, _p.sweep.phase == 2 ? sweep_lineColor : eqhl_color)

type SHLevel
	float price
```

- [ ] **Step 2: Compile check** — paste → Add to Chart. Expected: no errors; "㉓ Equal Highs/Lows" input group appears; no visual change yet (driver added next task).

- [ ] **Step 3: Commit**
```bash
git add merged_indicator.pine
git commit -m "feat(eqhl): add LiqPool type + EQH/EQL pool helpers + inputs"
```

---

## Task 8: EQH/EQL driver block (pivots → clustering → process)

**Files:**
- Modify: `merged_indicator.pine` — insert **after** the Liquidity driver block (after the `_lq_draw(lq_showPMH, ...)` line, ~line 2410)

- [ ] **Step 1: Insert the driver after the PMH/PML liquidity call**

Match:
```pine
if ENABLE_LIQUIDITY
	_lq_draw(lq_showPDH, _prevMidDayHi, _prevMidDayLo, lq_pdhColor, lq_pdlColor, lq_pdStyle, "PDH", "PDL")
	_lq_draw(lq_showPWH, _secWeekHi, _secWeekLo, lq_pwhColor, lq_pwlColor, lq_pwStyle, "PWH", "PWL")
	_lq_draw(lq_showPMH, _secMonthHi, _secMonthLo, lq_pmhColor, lq_pmlColor, lq_pmStyle, "PMH", "PML")
```
Replace with:
```pine
if ENABLE_LIQUIDITY
	_lq_draw(lq_showPDH, _prevMidDayHi, _prevMidDayLo, lq_pdhColor, lq_pdlColor, lq_pdStyle, "PDH", "PDL")
	_lq_draw(lq_showPWH, _secWeekHi, _secWeekLo, lq_pwhColor, lq_pwlColor, lq_pwStyle, "PWH", "PWL")
	_lq_draw(lq_showPMH, _secMonthHi, _secMonthLo, lq_pmhColor, lq_pmlColor, lq_pmStyle, "PMH", "PML")

var array<LiqPool> eqhPools = array.new<LiqPool>()
var array<LiqPool> eqlPools = array.new<LiqPool>()
var float _eqhlLastPH = na
var float _eqhlLastPL = na

if ENABLE_EQHL
	float _ph = ta.pivothigh(eqhl_pivotLen, eqhl_pivotLen)
	float _pl = ta.pivotlow(eqhl_pivotLen, eqhl_pivotLen)
	float _tol = ta.sma(high - low, eqhl_pivotLen) * eqhl_tolMult
	if not na(_ph)
		if not na(_eqhlLastPH) and math.abs(_ph - _eqhlLastPH) <= _tol
			f_eqhlAdd(eqhPools, math.max(_ph, _eqhlLastPH), _tol)
		_eqhlLastPH := _ph
	if not na(_pl)
		if not na(_eqhlLastPL) and math.abs(_pl - _eqhlLastPL) <= _tol
			f_eqhlAdd(eqlPools, math.min(_pl, _eqhlLastPL), _tol)
		_eqhlLastPL := _pl
	f_eqhlProcess(eqhPools, true)
	f_eqhlProcess(eqlPools, false)
```

- [ ] **Step 2: Static self-review** — `LiqPool`, `f_eqhlAdd`, `f_eqhlProcess` are defined above (Task 7) → definition-before-use OK. Pools are pruned to `eqhl_maxPools` per side. Sweep tick reuses the shared engine and is additionally gated by `ENABLE_SWEEPS` inside `f_eqhlProcess`.

- [ ] **Step 3: Compile check** — paste → Add to Chart, enable `ENABLE_EQHL`. Expected: no errors; dashed EQH/EQL lines appear where two swing pivots line up within tolerance.

- [ ] **Step 4: Manual verify** — confirm: (a) EQH/EQL lines appear at clusters of equal swing highs/lows and prune to the cap (≤10/side); (b) with `ENABLE_SWEEPS` also on, a wick-reject + reversal of an EQH recolors it swept and drops a `TS↓` marker; (c) `ENABLE_EQHL` off → no pools, zero cost.

- [ ] **Step 5: Commit**
```bash
git add merged_indicator.pine
git commit -m "feat(eqhl): detect Equal-High/Low pools via pivots + sweep them through the shared engine"
```

---

## Task 9: Phase 2 docs + final full verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Note the EQH/EQL sub-module in CLAUDE.md**

Extend the Liquidity Sweeps line added in Task 6 to mention: "Equal-High/Low pools (`LiqPool`, `ta.pivothigh/low`) gated by `ENABLE_EQHL` (default off); reuse the same sweep engine."

- [ ] **Step 2: Run the entire spec §12 checklist end-to-end** with every module enabled — confirm total drawing count stays < 500 (EQH/EQL pruned to cap), no compile errors, no repaint, alerts fire once per confirmed sweep.

- [ ] **Step 3: Commit**
```bash
git add CLAUDE.md
git commit -m "docs(eqhl): document Equal-High/Low pools sub-module"
```

---

## Self-Review (completed by plan author)

**Spec coverage:** §4 SweepState → Task 2 ✓; §5.1 f_sweepTick → Task 2 ✓; §5.2 f_sweepMark (marker+alert only, no line set) → Task 2 ✓; §6 wiring session H/L (incl. host-owned recolor + archive cleanup) → Tasks 3–4 ✓; §6 wiring PD/PW/PM (incl. per-bar recolor) → Task 5 ✓; §6 EQH/EQL Phase 2 → Tasks 7–8 ✓; §7 alerts (`wh_sweeps`, event names, freq_once_per_bar, 0 outputs) → Tasks 1–2 ✓; §8 inputs (groups ⓪/㉑/㉒/㉓) → Tasks 1, 2, 7 ✓; §9 repaint (barstate.isconfirmed) → Task 2 ✓; §10 budget (recolor existing line, marker prune via archive/roll/cap) → Tasks 3, 5, 7 ✓; §11 edge cases (na guards, sweep≠mitigation, value-roll reset, marker lifecycle) → Tasks 2–5 ✓; §12 verification → Tasks 4, 5, 6, 8, 9 ✓; §13 docs → Tasks 6, 9 ✓.

**Placeholder scan:** none — every code step contains full Pine, every verify step a concrete check.

**Type consistency:** `SweepState` fields (`phase`, `levelPrice`, `sweepBar`, `confirmLevel`, `sweepTime`, `marker`) used identically in `f_sweepTick`/`f_sweepMark`/host modules; `f_sweepTick(st, lvl, isHigh, confirmBars)` and `f_sweepMark(st, name, isHigh)` signatures match every call site (Tasks 4, 5, 7); `LiqPool` (`price`, `ln`, `lbl`, `sweep`) consistent across Tasks 7–8.
