# Multi-Level Liquidity History (PDH/PDL · PWH/PWL · PMH/PML) — Design Spec

**Date:** 2026-06-06
**Status:** Approved design — ready for implementation
**Target:** `merged_indicator.pine` (Pine v6, single file)
**Branch:** `claude/multi-level-liquidity`

---

## 1. Goal

Rework the **⑳ Liquidity Levels** module from "single most-recent previous PDH/PDL, PWH/PWL, PMH/PML" into **multiple historical period highs & lows over a ~60-day window**, each with **close-through mitigation** (greys out) and the existing **⚡ sweep / Turtle-Soup** detection. Architecturally a near-clone of the **⑲ Session Highs/Lows** module, reusing its `SHLevel` type and the shared sweep engine.

## 2. Decisions (locked)

- **Lookback:** ~60-calendar-day window **and** per-TF count caps; prune by **both**.
- **Replace** the current single-level draw — the newest history entry is today's level; the existing `_lq_draw()` function is **removed**.
- **Mitigation rule:** close-through (high level: `close > price`; low level: `close < price`), under `barstate.isconfirmed` — identical to ⑲.
- **Sweep/TS:** kept per level (reuse the shared `SweepState` engine).
- **Renderer:** a **sibling** `_lq_processHist` (⑲'s `_sh_processHist` left untouched); reuse `SHLevel` + `SweepState`.
- **Daily boundary:** **NY-midnight** → daily history is **intraday-only**. Weekly/Monthly via `request.security` → work on **all** chart timeframes.
- **Mitigated display:** grey out and keep, hidden via a `lq_showMit` toggle.

## 3. Data model (reuse — no new UDTs)

Reuse `SHLevel` (`price`, `startBar`, `priceTime`, `mitigated`, `ln`, `lbl`, `sweep`) and `SweepState`.

Six new persistent arrays:

```pine
var array<SHLevel> lq_histDayH   = array.new<SHLevel>()
var array<SHLevel> lq_histDayL   = array.new<SHLevel>()
var array<SHLevel> lq_histWeekH  = array.new<SHLevel>()
var array<SHLevel> lq_histWeekL  = array.new<SHLevel>()
var array<SHLevel> lq_histMonthH = array.new<SHLevel>()
var array<SHLevel> lq_histMonthL = array.new<SHLevel>()
```

## 4. Collection & prune

**Weekly / Monthly (all chart TFs).** Extend the *existing* security calls to also return the period time (no new `request.security` call):

```pine
[_secWeekHi,  _secWeekLo,  _secWeekT]  = request.security(syminfo.tickerid, "W", [high[1], low[1], time[1]], lookahead = barmerge.lookahead_on)
[_secMonthHi, _secMonthLo, _secMonthT] = request.security(syminfo.tickerid, "M", [high[1], low[1], time[1]], lookahead = barmerge.lookahead_on)
```

Rollover detection by **period-time change** (robust against two consecutive periods sharing a high/low): keep `var int _lqPrevWeekT = na` / `_lqPrevMonthT`; when `not na(_secWeekHi) and (na(prevT) or _secWeekT != prevT)`, `unshift` `SHLevel.new(price=_secWeekHi, startBar=bar_index, priceTime=_secWeekT)` onto `lq_histWeekH` and the low onto `lq_histWeekL`, then prune; set `prevT := _secWeekT`. Same for monthly. The `not na(_secWeekHi)` guard skips `request.security` warm-up bars (no na-priced level is ever archived). Runs under `ENABLE_LIQUIDITY`.

**Daily (NY-midnight, intraday-only).** Hook the *existing* midnight-rollover block (`if _isMidNY and not _wasMidnight`, which already runs under `timeframe.isintraday and (ENABLE_LIQUIDITY or ENABLE_PDA_SCANNER)`). At rollover, the just-completed NY day's H/L are the current `_midDayHi`/`_midDayLo` (before they reset) — i.e. the new `_prevMidDayHi/Lo`. `unshift` those into `lq_histDayH/L` with `priceTime = time`, `startBar = bar_index`, then prune. The existing `_prevMidDayHi/Lo` assignment is **left intact** (PDA/Dashboard still consume it). Guard the archive with `ENABLE_LIQUIDITY` (and skip when `na(_midDayHi)` on the very first day).

**Prune helper** (count + age, deletes drawings):

```pine
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
```

`_lookbackMs = lq_lookbackDays * 86400000`. Arrays are newest-at-index-0 (`unshift`), so `last()` is oldest. Pruning runs at archive time; a level can therefore outlive the window by at most one period until the next rollover prunes it (documented limitation).

## 5. Renderer `_lq_processHist` (sibling of `_sh_processHist`)

```pine
_lq_processHist(_show, array<SHLevel> _hist, _isHigh, _color, _style, _name) =>
	if _show and _hist.size() > 0
		for i = 0 to _hist.size() - 1
			SHLevel _lvl = _hist.get(i)
			if na(_lvl.price)
				continue
			if _lvl.mitigated and not lq_showMit
				line.delete(_lvl.ln), label.delete(_lvl.lbl)
				_lvl.ln := line(na), _lvl.lbl := label(na)
				if not na(_lvl.sweep)
					label.delete(_lvl.sweep.marker), _lvl.sweep.marker := na
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
			string _swTxt  = _swept ? " ⚡TS" : ""
			string _mitTxt = _lvl.mitigated ? " [Mitigated]" : ""
			string _txt = _name + " " + str.tostring(_lvl.price, format.mintick) + _swTxt + _mitTxt
			string _ls  = _lvl.mitigated ? line.style_dotted : f_get_line_style(_style)
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
```

Mitigation restyle is folded into the per-bar redraw (colour + dotted style derive from `_lvl.mitigated`), so no separate restyle branch is needed. Label format stays concise (`PWH 30500.00 ⚡TS [Mitigated]`) rather than ⑲'s "Buyside/Sellside Liquidity" verbiage. Line extend fixed at `+30` (matches the current `_lq_draw`), saving an input.

## 6. Inputs (⑳ Liquidity Levels)

**Reuse** existing: `lq_showPDH` (daily master), `lq_pdhColor`/`lq_pdlColor`/`lq_pdStyle`; `lq_showPWH` + week colours/style; `lq_showPMH` + month colours/style; `lq_lineWidth`; `lq_showLabels`.

**Add** (6 inputs):

```pine
var int   lq_lookbackDays = input.int(60, "History (days)",   minval=1, maxval=365, group="⑳ Liquidity Levels", inline="lq5")
var int   lq_maxDaily     = input.int(15, "Max D",            minval=1, maxval=60,  group="⑳ Liquidity Levels", inline="lq5")
var int   lq_maxWeekly    = input.int(10, "Max W",            minval=1, maxval=30,  group="⑳ Liquidity Levels", inline="lq5")
var int   lq_maxMonthly   = input.int(6,  "Max M",            minval=1, maxval=12,  group="⑳ Liquidity Levels", inline="lq5")
var bool  lq_showMit      = input.bool(true, "Show Mitigated", group="⑳ Liquidity Levels", inline="lq6")
var color lq_mitColor     = input.color(color.new(color.gray, 50), "", group="⑳ Liquidity Levels", inline="lq6")
```

(If on-chart compile shows the token ceiling is tight, collapse the three caps into one shared `lq_maxPerTF` and/or drop `lq_lookbackDays` to a constant.)

## 7. Per-bar driver

Replace the existing block

```pine
if ENABLE_LIQUIDITY
	_lq_draw(lq_showPDH, _prevMidDayHi, _prevMidDayLo, lq_pdhColor, lq_pdlColor, lq_pdStyle, "PDH", "PDL")
	_lq_draw(lq_showPWH, _secWeekHi, _secWeekLo, lq_pwhColor, lq_pwlColor, lq_pwStyle, "PWH", "PWL")
	_lq_draw(lq_showPMH, _secMonthHi, _secMonthLo, lq_pmhColor, lq_pmlColor, lq_pmStyle, "PMH", "PML")
```

with:

1. **Weekly/Monthly archive** (rollover by period-time change → `unshift` + `f_lqPrune`), under `ENABLE_LIQUIDITY`, at global scope near the existing security calls.
2. **Daily archive** folded into the existing midnight-rollover block (intraday).
3. **Render** under `ENABLE_LIQUIDITY`:

```pine
if ENABLE_LIQUIDITY
	_lq_processHist(lq_showPDH, lq_histDayH,   true,  lq_pdhColor, lq_pdStyle, "PDH")
	_lq_processHist(lq_showPDH, lq_histDayL,   false, lq_pdlColor, lq_pdStyle, "PDL")
	_lq_processHist(lq_showPWH, lq_histWeekH,  true,  lq_pwhColor, lq_pwStyle, "PWH")
	_lq_processHist(lq_showPWH, lq_histWeekL,  false, lq_pwlColor, lq_pwStyle, "PWL")
	_lq_processHist(lq_showPMH, lq_histMonthH, true,  lq_pmhColor, lq_pmStyle, "PMH")
	_lq_processHist(lq_showPMH, lq_histMonthL, false, lq_pmlColor, lq_pmStyle, "PML")
```

The `_lq_draw()` function definition is deleted.

## 8. Preserved (no breakage)

`_prevMidDayHi/Lo`, `_secWeekHi/Lo`, `_secMonthHi/Lo` are unchanged — the PDA Scanner (㉕) and Dashboard (㉖) keep working exactly as before; the newest history entry per TF equals these.

## 9. Drawing & token budget

Worst case ≈ (15 + 10 + 6) × 2 = **62 lines + 62 labels** + ≤ swept-count sweep markers. Shared against the 500-each cap with Session H/L, imbalances, OB, sweeps — caps are tunable. Token: near the ~100K ceiling; **verify headroom on-chart**, trim per §6 if tight.

## 10. Repaint safety

Mitigation and sweep transitions are gated by `barstate.isconfirmed`; lines/labels are created once and moved via setters (the established create-once pattern).

## 11. Known limitations (→ document in CLAUDE.md)

- **Daily history is intraday-only** (blank on weekly/daily charts) — a consequence of the NY-midnight boundary. Weekly/Monthly render on every chart timeframe.
- **Shared 500-drawing cap**: with many features on, the liquidity history competes for the budget; caps are tunable.
- Tracks **period H/L only** (no intra-period structure), same as today.
- **Age-prune is evaluated at archive time**, so a level can outlive the 60-day window by up to one period until the next rollover prunes it.
- Rollover uses HTF `time[1]`; on instruments with unusual session calendars the weekly/monthly boundary follows the data feed.

## 12. Verification (manual — TradingView only)

1. `ENABLE_LIQUIDITY` off → no ⑳ drawings, compiles clean, acceptable token count.
2. **Weekly chart** → multiple PWH/PWL and PMH/PML over ~60 days; **daily blank** (expected).
3. **Intraday chart** → daily PDH/PDL history appears; weekly/monthly still present.
4. A bar **closes through** a level → it greys (dotted, `lq_mitColor`); `lq_showMit` off hides it; re-enabling shows it again.
5. A **wick-reject + close back inside** → ⚡TS mark + line recolor (sweep), independent of mitigation.
6. Caps respected (oldest pruned); levels older than `lq_lookbackDays` drop off; per-TF caps honored.
7. PDA Scanner (㉕) and Dashboard (㉖) still correct — newest history level matches `_prevMidDayHi/Lo` / `_secWeekHi/Lo` / `_secMonthHi/Lo`.
8. Scroll/zoom and bar-replay → confirmed levels do not repaint.
