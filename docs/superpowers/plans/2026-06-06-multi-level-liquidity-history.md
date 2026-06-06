# Multi-Level Liquidity History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework ⑳ Liquidity Levels (`merged_indicator.pine`) from single previous PDH/PDL·PWH/PWL·PMH/PML into multiple historical D/W/M highs & lows over a 60-day window, each with close-through mitigation (grey-out) and the existing ⚡ sweep detection.

**Architecture:** Reuse the `SHLevel` UDT + the shared `SweepState` sweep engine (exactly as ⑲ Session H/L does). Six `var array<SHLevel>` history arrays are filled on D/W/M rollover (weekly/monthly via the existing `request.security` calls extended to carry `time[1]`; daily via the existing NY-midnight intraday block), pruned by a per-TF count cap **and** a 60-day age cutoff, and rendered by a new sibling function `_lq_processHist`. The old `_lq_draw` single-level function is removed. `_prevMidDayHi/Lo` and `_secWeek/Month` globals are left intact so the PDA Scanner (㉕) and Dashboard (㉖) are unaffected.

**Tech Stack:** Pine Script v6, single file `merged_indicator.pine`, TradingView only (no build/test harness).

**Spec:** `docs/superpowers/specs/2026-06-06-multi-level-liquidity-history-design.md`

**Branch:** `claude/multi-level-liquidity` (already created; `_tfWarning` removal + spec already committed).

---

## Constraints for every task

- **Pine uses TAB indentation.** All code blocks below are tab-indented — preserve tabs exactly. The #1 failure mode here is tab mismatches in `old_string`. **Read the exact region first** before editing.
- **No compile in this environment.** You cannot run/compile Pine. Do a careful static `git diff` self-review against the task's code; the human compiles + verifies on TradingView at the end.
- **Use the Bash tool for git;** if Bash reports `git: command not found`, use the PowerShell tool with `;` instead of `&&`.
- Make **only** the edit(s) in the current task.

---

### Task 1: ⑳ inputs (caps, lookback, mitigated styling)

**Files:**
- Modify: `merged_indicator.pine` (⑳ Liquidity Levels input group, ~line 321)

- [ ] **Step 1: Add the six new inputs after `lq_lineWidth`**

Use the Edit tool. Match this `old_string` (it is unique — the last existing ⑳ input line):

```
var int lq_lineWidth=input.int(1, "Width", 1, 4, group="⑳ Liquidity Levels", inline="lq4")
```

Replace with:

```
var int lq_lineWidth=input.int(1, "Width", 1, 4, group="⑳ Liquidity Levels", inline="lq4")
var int   lq_lookbackDays = input.int(60, "History (days)", minval=1, maxval=365, group="⑳ Liquidity Levels", inline="lq5")
var int   lq_maxDaily     = input.int(15, "Max D", minval=1, maxval=60, group="⑳ Liquidity Levels", inline="lq5")
var int   lq_maxWeekly    = input.int(10, "Max W", minval=1, maxval=30, group="⑳ Liquidity Levels", inline="lq5")
var int   lq_maxMonthly   = input.int(6, "Max M", minval=1, maxval=12, group="⑳ Liquidity Levels", inline="lq5")
var bool  lq_showMit      = input.bool(true, "Show Mitigated", group="⑳ Liquidity Levels", inline="lq6")
var color lq_mitColor     = input.color(color.new(color.gray, 50), "", group="⑳ Liquidity Levels", inline="lq6")
```

- [ ] **Step 2: Static self-review**

`git diff` shows exactly six new input lines inserted directly after `lq_lineWidth`, all `group="⑳ Liquidity Levels"`, no other change.

- [ ] **Step 3: Commit**

```
git add merged_indicator.pine
git commit -m "feat(liquidity): add ⑳ history caps, lookback, and mitigated-style inputs"
```

**Manual verify (deferred to checkpoint):** group ⑳ shows the new History(days)/Max D/W/M row and a Show-Mitigated + colour row.

---

### Task 2: Data model + helpers (`lq_hist*` arrays, `f_lqPrune`, `_lq_processHist`)

**Files:**
- Modify: `merged_indicator.pine` (insert immediately before the existing `_lq_draw(...)` function definition, ~line 2545)

Dependencies already defined earlier in the file: `SHLevel`, `SweepState`, `f_sweepTick`, `f_sweepMark`, `f_get_line_style`, `ENABLE_SWEEPS`, `sweep_confirmBars`, `sweep_lineColor`, and (from Task 1) `lq_showMit`, `lq_mitColor`, `lq_lineWidth`, `lq_showLabels`.

- [ ] **Step 1: Read the region** around the `_lq_draw` definition to confirm the anchor line and its surroundings.

- [ ] **Step 2: Insert the arrays + helpers before `_lq_draw`**

Match this `old_string` (the `_lq_draw` signature line — unique):

```
_lq_draw(_show, _hi, _lo, _hClr, _lClr, _style, _hName, _lName) =>
```

Replace with (NOTE: the whole new block, then the original signature line at the end so the insert lands *before* `_lq_draw`; tabs throughout):

```
// ===== ⑳ Liquidity Levels — multi-level history (reuses SHLevel + sweep engine) =====
var array<SHLevel> lq_histDayH   = array.new<SHLevel>()
var array<SHLevel> lq_histDayL   = array.new<SHLevel>()
var array<SHLevel> lq_histWeekH  = array.new<SHLevel>()
var array<SHLevel> lq_histWeekL  = array.new<SHLevel>()
var array<SHLevel> lq_histMonthH = array.new<SHLevel>()
var array<SHLevel> lq_histMonthL = array.new<SHLevel>()

// Prune a level array by count cap, then by age (deletes drawings). Newest is index 0; oldest is last().
f_lqPrune(array<SHLevel> _arr, int _cap, int _lookbackMs) =>
	while _arr.size() > _cap
		SHLevel _o = _arr.pop()
		line.delete(_o.ln)
		label.delete(_o.lbl)
		if not na(_o.sweep)
			label.delete(_o.sweep.marker)
	while _arr.size() > 0 and not na(_arr.last().priceTime) and (time - _arr.last().priceTime) > _lookbackMs
		SHLevel _o = _arr.pop()
		line.delete(_o.ln)
		label.delete(_o.lbl)
		if not na(_o.sweep)
			label.delete(_o.sweep.marker)

// Draw/update one liquidity-level array: shared sweep detection, close-through mitigation, grey-out.
_lq_processHist(_show, array<SHLevel> _hist, _isHigh, _color, _style, _name) =>
	if _show and _hist.size() > 0
		for i = 0 to _hist.size() - 1
			SHLevel _lvl = _hist.get(i)
			if na(_lvl.price)
				continue
			if _lvl.mitigated and not lq_showMit
				line.delete(_lvl.ln)
				label.delete(_lvl.lbl)
				_lvl.ln := line(na)
				_lvl.lbl := label(na)
				if not na(_lvl.sweep)
					label.delete(_lvl.sweep.marker)
					_lvl.sweep.marker := na
				continue
			if ENABLE_SWEEPS
				if na(_lvl.sweep)
					_lvl.sweep := SweepState.new()
				if f_sweepTick(_lvl.sweep, _lvl.price, _isHigh, sweep_confirmBars)
					f_sweepMark(_lvl.sweep, _name, _isHigh)
			if not _lvl.mitigated and barstate.isconfirmed
				bool _hit = _isHigh ? close > _lvl.price : close < _lvl.price
				if _hit
					_lvl.mitigated := true
			int _x1 = math.max(nz(_lvl.startBar, bar_index - 1), 0)
			int _x2 = bar_index + 30
			bool _swept = ENABLE_SWEEPS and not na(_lvl.sweep) and _lvl.sweep.phase == 2
			color _lineClr = _swept ? sweep_lineColor : _lvl.mitigated ? lq_mitColor : _color
			string _swTxt = _swept ? " ⚡TS" : ""
			string _mitTxt = _lvl.mitigated ? " [Mitigated]" : ""
			string _txt = _name + " " + str.tostring(_lvl.price, format.mintick) + _swTxt + _mitTxt
			string _ls = _lvl.mitigated ? line.style_dotted : f_get_line_style(_style)
			if na(_lvl.ln)
				_lvl.ln := line.new(_x1, _lvl.price, _x2, _lvl.price, color=_lineClr, style=_ls, width=lq_lineWidth)
			line.set_xy1(_lvl.ln, _x1, _lvl.price)
			line.set_xy2(_lvl.ln, _x2, _lvl.price)
			line.set_color(_lvl.ln, _lineClr)
			line.set_style(_lvl.ln, _ls)
			if lq_showLabels
				if na(_lvl.lbl)
					_lvl.lbl := label.new(_x2, _lvl.price, _txt, style=label.style_label_left, color=color.new(color.white, 100), textcolor=_lineClr, size=size.small)
				label.set_xy(_lvl.lbl, _x2, _lvl.price)
				label.set_text(_lvl.lbl, _txt)
				label.set_textcolor(_lvl.lbl, _lineClr)

_lq_draw(_show, _hi, _lo, _hClr, _lClr, _style, _hName, _lName) =>
```

- [ ] **Step 3: Static self-review**

`git diff`: the new comment + 6 arrays + `f_lqPrune` + `_lq_processHist` are inserted directly before the (still-present) `_lq_draw` definition. `_lq_processHist` references only symbols defined earlier in the file or in this block. Indentation is tabs. `_lq_draw` is unchanged (removed in Task 5).

- [ ] **Step 4: Commit**

```
git add merged_indicator.pine
git commit -m "feat(liquidity): SHLevel history arrays + f_lqPrune + _lq_processHist renderer"
```

**Manual verify:** none yet (defs unused until Task 5).

---

### Task 3: Collection — weekly & monthly (security rollover archive)

**Files:**
- Modify: `merged_indicator.pine` (the W/M `request.security` lines ~2578-2579, then insert an archive block after them)

- [ ] **Step 1: Extend the two security calls to carry the period time**

Match this `old_string`:

```
[_secWeekHi, _secWeekLo] = request.security(syminfo.tickerid, "W", [high[1], low[1]], lookahead = barmerge.lookahead_on)
[_secMonthHi, _secMonthLo] = request.security(syminfo.tickerid, "M", [high[1], low[1]], lookahead = barmerge.lookahead_on)
```

Replace with:

```
[_secWeekHi, _secWeekLo, _secWeekT] = request.security(syminfo.tickerid, "W", [high[1], low[1], time[1]], lookahead = barmerge.lookahead_on)
[_secMonthHi, _secMonthLo, _secMonthT] = request.security(syminfo.tickerid, "M", [high[1], low[1], time[1]], lookahead = barmerge.lookahead_on)

var int _lqPrevWeekT = na
var int _lqPrevMonthT = na
int _lqLookbackMs = lq_lookbackDays * 86400000
if ENABLE_LIQUIDITY
	if not na(_secWeekHi) and (na(_lqPrevWeekT) or _secWeekT != _lqPrevWeekT)
		lq_histWeekH.unshift(SHLevel.new(price = _secWeekHi, startBar = bar_index, priceTime = _secWeekT))
		lq_histWeekL.unshift(SHLevel.new(price = _secWeekLo, startBar = bar_index, priceTime = _secWeekT))
		f_lqPrune(lq_histWeekH, lq_maxWeekly, _lqLookbackMs)
		f_lqPrune(lq_histWeekL, lq_maxWeekly, _lqLookbackMs)
		_lqPrevWeekT := _secWeekT
	if not na(_secMonthHi) and (na(_lqPrevMonthT) or _secMonthT != _lqPrevMonthT)
		lq_histMonthH.unshift(SHLevel.new(price = _secMonthHi, startBar = bar_index, priceTime = _secMonthT))
		lq_histMonthL.unshift(SHLevel.new(price = _secMonthLo, startBar = bar_index, priceTime = _secMonthT))
		f_lqPrune(lq_histMonthH, lq_maxMonthly, _lqLookbackMs)
		f_lqPrune(lq_histMonthL, lq_maxMonthly, _lqLookbackMs)
		_lqPrevMonthT := _secMonthT
```

- [ ] **Step 2: Static self-review**

`git diff`: both security calls are now 3-tuples ending `, time[1]]`; `_secWeekHi/_secWeekLo/_secMonthHi/_secMonthLo` names are unchanged (so PDA/Dashboard still resolve). The archive block is gated by `ENABLE_LIQUIDITY`, rollover by `_secWeekT != _lqPrevWeekT` with a `not na(_secWeekHi)` warm-up guard, and `f_lqPrune` is called per side. `_lqLookbackMs` is declared here (Task 4 reuses it).

- [ ] **Step 3: Commit**

```
git add merged_indicator.pine
git commit -m "feat(liquidity): archive weekly/monthly H/L on rollover (60d window + cap)"
```

**Manual verify:** on any timeframe, multiple PWH/PWL & PMH/PML lines appear after Task 5.

---

### Task 4: Collection — daily (NY-midnight intraday archive)

**Files:**
- Modify: `merged_indicator.pine` (inside the existing midnight block, ~lines 2589-2593)

- [ ] **Step 1: Read the midnight block** to confirm exact tab depth (the `if _isMidNY` body is at **2 tabs**).

- [ ] **Step 2: Insert the daily archive between the `_prevMidDay*` assignments and the resets**

Match this `old_string`:

```
		if _isMidNY and not _wasMidnight
			_prevMidDayHi := _midDayHi
			_prevMidDayLo := _midDayLo
			_midDayHi := high
			_midDayLo := low
```

Replace with:

```
		if _isMidNY and not _wasMidnight
			_prevMidDayHi := _midDayHi
			_prevMidDayLo := _midDayLo
			if ENABLE_LIQUIDITY and not na(_midDayHi)
				lq_histDayH.unshift(SHLevel.new(price = _midDayHi, startBar = bar_index, priceTime = time))
				lq_histDayL.unshift(SHLevel.new(price = _midDayLo, startBar = bar_index, priceTime = time))
				f_lqPrune(lq_histDayH, lq_maxDaily, _lqLookbackMs)
				f_lqPrune(lq_histDayL, lq_maxDaily, _lqLookbackMs)
			_midDayHi := high
			_midDayLo := low
```

- [ ] **Step 3: Static self-review**

`git diff`: the archive uses `_midDayHi/_midDayLo` (the just-completed day, captured **before** the `:= high` reset), guarded by `ENABLE_LIQUIDITY and not na(_midDayHi)`; `priceTime = time`; the existing `_prevMidDayHi/Lo` assignments are untouched. Indentation: `if ENABLE_LIQUIDITY...` at 3 tabs, its body at 4 tabs.

- [ ] **Step 4: Commit**

```
git add merged_indicator.pine
git commit -m "feat(liquidity): archive previous NY-day H/L into daily history (intraday)"
```

**Manual verify:** on an intraday chart, daily PDH/PDL history appears after Task 5.

---

### Task 5: Driver swap — remove `_lq_draw`, render via `_lq_processHist`

**Files:**
- Modify: `merged_indicator.pine` (remove the `_lq_draw` function ~2545-2576; replace the driver ~2603-2606)

- [ ] **Step 1: Remove the `_lq_draw` function definition**

Match this `old_string` (the entire function plus its trailing blank line) and replace with an **empty string**:

```
_lq_draw(_show, _hi, _lo, _hClr, _lClr, _style, _hName, _lName) =>
	var line _lnH = na, var line _lnL = na
	var label _lbH = na, var label _lbL = na
	var SweepState _swH = SweepState.new()
	var SweepState _swL = SweepState.new()
	if _show and not na(_hi)
		if na(_lnH)
			_lnH := line.new(bar_index - 1, _hi, bar_index + 30, _hi, color=_hClr, style=f_get_line_style(_style), width=lq_lineWidth)
			_lnL := line.new(bar_index - 1, _lo, bar_index + 30, _lo, color=_lClr, style=f_get_line_style(_style), width=lq_lineWidth)
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
			string _hTxt = _hName + " " + str.tostring(_hi, format.mintick)
			string _lTxt = _lName + " " + str.tostring(_lo, format.mintick)
			if na(_lbH)
				_lbH := label.new(bar_index + 30, _hi, _hTxt, style=label.style_label_left, color=color.new(color.white, 100), textcolor=_hClr, size=size.small)
				_lbL := label.new(bar_index + 30, _lo, _lTxt, style=label.style_label_left, color=color.new(color.white, 100), textcolor=_lClr, size=size.small)
			else
				label.set_x(_lbH, bar_index + 30), label.set_y(_lbH, _hi), label.set_text(_lbH, _hTxt)
				label.set_x(_lbL, bar_index + 30), label.set_y(_lbL, _lo), label.set_text(_lbL, _lTxt)
				_lbL

```

(That trailing blank line is the separator before `[_secWeekHi...`. After removal, the new-code block from Task 2 is followed directly by the `[_secWeekHi...` line — verify one blank line remains between them; if two blanks result, that's harmless.)

- [ ] **Step 2: Replace the driver block with six `_lq_processHist` calls**

Match this `old_string`:

```
if ENABLE_LIQUIDITY
	_lq_draw(lq_showPDH, _prevMidDayHi, _prevMidDayLo, lq_pdhColor, lq_pdlColor, lq_pdStyle, "PDH", "PDL")
	_lq_draw(lq_showPWH, _secWeekHi, _secWeekLo, lq_pwhColor, lq_pwlColor, lq_pwStyle, "PWH", "PWL")
	_lq_draw(lq_showPMH, _secMonthHi, _secMonthLo, lq_pmhColor, lq_pmlColor, lq_pmStyle, "PMH", "PML")
```

Replace with:

```
if ENABLE_LIQUIDITY
	_lq_processHist(lq_showPDH, lq_histDayH,   true,  lq_pdhColor, lq_pdStyle, "PDH")
	_lq_processHist(lq_showPDH, lq_histDayL,   false, lq_pdlColor, lq_pdStyle, "PDL")
	_lq_processHist(lq_showPWH, lq_histWeekH,  true,  lq_pwhColor, lq_pwStyle, "PWH")
	_lq_processHist(lq_showPWH, lq_histWeekL,  false, lq_pwlColor, lq_pwStyle, "PWL")
	_lq_processHist(lq_showPMH, lq_histMonthH, true,  lq_pmhColor, lq_pmStyle, "PMH")
	_lq_processHist(lq_showPMH, lq_histMonthL, false, lq_pmlColor, lq_pmStyle, "PML")
```

- [ ] **Step 3: Static self-review**

`git diff`: `_lq_draw` is fully gone (grep the file for `_lq_draw` → no matches). The driver calls `_lq_processHist` six times (D/W/M × H/L) with the matching per-TF colour/style/name and the `lq_showPDH/PWH/PMH` master toggles. No reference to `_prevMidDayHi/Lo`, `_secWeekHi/Lo`, `_secMonthHi/Lo` is removed elsewhere (PDA/Dashboard still use them).

- [ ] **Step 4: Commit**

```
git add merged_indicator.pine
git commit -m "feat(liquidity): render multi-level history; remove single-level _lq_draw"
```

**Manual verify (CHECKPOINT — human, TradingView):** see spec §12. Key: weekly chart shows multiple PWH/PWL+PMH/PML over 60d (daily blank); intraday shows daily history; body-close greys a level; `lq_showMit` hides mitigated; ⚡TS still marks sweeps; caps/age respected; PDA + Dashboard unchanged; token headroom OK.

---

### Task 6: Docs — CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (Section Layout, the "9. Liquidity Levels" entry)

- [ ] **Step 1: Read** the Section Layout block in `CLAUDE.md` to get the exact current text of the line beginning `9. **Liquidity Levels**`.

- [ ] **Step 2: Replace that single line** with an expanded description. Match (confirm exact text first):

```
9. **Liquidity Levels** — PDH/PDL, PWH/PWL, PMH/PML
```

Replace with:

```
9. **Liquidity Levels** — PDH/PDL, PWH/PWL, PMH/PML as **multi-level history** (gated `ENABLE_LIQUIDITY`). Each completed day/week/month H/L is archived on rollover into `lq_hist{Day,Week,Month}{H,L}` arrays of `SHLevel` (reused from ⑲), pruned by a per-TF count cap (`lq_maxDaily/Weekly/Monthly`) **and** a `lq_lookbackDays` (60) age cutoff (`f_lqPrune`). Rendered by `_lq_processHist` (sibling of `_sh_processHist`): shared sweep/Turtle-Soup detection + **close-through mitigation** (a confirmed `close` beyond the level greys it to dotted `lq_mitColor`, hidden by `lq_showMit`). Weekly/monthly are collected via the existing `request.security("W"/"M", […, time[1]])` calls (no new security call) and render on all chart TFs; **daily uses the NY-midnight intraday tracker, so daily history is intraday-only** (blank on non-intraday charts). `_prevMidDayHi/Lo` and `_secWeek/Month` globals are preserved, so the PDA Scanner and Dashboard are unaffected. Known limits: shared 500-drawing cap (caps tunable); age-prune is evaluated at archive time, so a level can outlive the window by up to one period.
```

- [ ] **Step 3: Commit**

```
git add CLAUDE.md
git commit -m "docs(liquidity): document multi-level liquidity history + limitations"
```

---

## Execution notes

- **Subagent-Driven.** Tasks 1 & 6 get a controller-level review (trivial input/doc edits). Tasks 2–5 (renderer + collection + driver swap) are substantive — after implementation, run an **adversarial codex review** (Pine v6 validity, the `array<SHLevel>` typed params, `array.last()` usage, rollover/na-guard correctness, mitigation logic, no `_lq_draw` references left, drawing-leak on prune/hide, and that PDA/Dashboard reads still resolve), fix any BLOCKER/HIGH, re-review.
- **No per-task compile.** The human compiles + on-chart verifies at the Task 5 checkpoint (spec §12), watching token headroom.
- **Finish:** after verification, use `superpowers:finishing-a-development-branch` (merge `claude/multi-level-liquidity` → main + push, the established pattern).

## Plan self-review

- **Spec coverage:** §2 decisions → Tasks 1–5; §3 data model → Task 2; §4 collection+prune → Tasks 2 (prune helper), 3 (W/M), 4 (daily); §5 renderer → Task 2; §6 inputs → Task 1; §7 driver → Task 5; §8 preserved globals → verified in Tasks 3 & 5 reviews; §11 limitations → Task 6. ✔ All covered.
- **Type consistency:** `SHLevel` fields (`price/startBar/priceTime/mitigated/ln/lbl/sweep`), `f_lqPrune(array<SHLevel>, int, int)`, `_lq_processHist(_show, array<SHLevel>, _isHigh, _color, _style, _name)`, array names `lq_hist{Day,Week,Month}{H,L}`, and input names (`lq_lookbackDays/maxDaily/maxWeekly/maxMonthly/showMit/mitColor`) are used identically across Tasks 1–6. ✔
- **Placeholder scan:** none — every code step has full Pine. ✔
