# Bias / Confluence Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a gated corner `table` summarizing Bias (premium/discount), Structure (trend + last BOS/CHoCH), nearest untapped liquidity above/below, and active killzone.

**Architecture:** Read-only aggregation of existing globals, drawn once as a `var table`, populated only on `barstate.islast`. One small hook (`struct_lastBreak`) into the Market Structure module; everything else read-only. Gated `ENABLE_DASHBOARD`, default off.

**Tech Stack:** Pine Script v6, single file `merged_indicator.pine`. **No automated tests** — TradingView only.

---

## ⚠️ How to "test" here (read first)

No test runner. Each **Compile check** = paste the whole `merged_indicator.pine` into the TradingView **Pine Editor** → **Add to Chart** → confirm no red errors. Each **Manual verify** = on-chart visual check. An automated agent **cannot** do these — it makes the edit, statically self-reviews the diff (Pine syntax, def-before-use, tab indentation), then **pauses for the human** to compile/verify before (or right after) committing.

**Spec:** `docs/superpowers/specs/2026-06-04-bias-confluence-dashboard-design.md`
**Branch:** `claude/bias-confluence-dashboard`
All line numbers are approximate — every Modify step gives **anchor text** to match.

---

## Task 1: `ENABLE_DASHBOARD` toggle

**Files:** Modify `merged_indicator.pine` (⓪ Section Toggles, ~line 31)

- [ ] **Step 1: Add the toggle after `ENABLE_STRUCTURE`**

Match:
```pine
var bool ENABLE_STRUCTURE=input.bool(false, "Enable Market Structure (BOS/CHoCH)", group="⓪ Section Toggles")
```
Replace with:
```pine
var bool ENABLE_STRUCTURE=input.bool(false, "Enable Market Structure (BOS/CHoCH)", group="⓪ Section Toggles")
var bool ENABLE_DASHBOARD=input.bool(false, "Enable Dashboard", group="⓪ Section Toggles")
```

- [ ] **Step 2: Compile check** — paste → Add to Chart. Expected: no errors; new "Enable Dashboard" toggle in the ⓪ group.

- [ ] **Step 3: Commit**
```bash
git add merged_indicator.pine
git commit -m "feat(dashboard): add ENABLE_DASHBOARD toggle"
```

---

## Task 2: `struct_lastBreak` hook in the Market Structure module

**Files:** Modify `merged_indicator.pine` (structure state globals ~line 2305; structure driver ~line 2735)

- [ ] **Step 1: Declare the global after `struct_trend`**

Match:
```pine
var int   struct_trend = 0
var BosState bosH = BosState.new()
```
Replace with:
```pine
var int   struct_trend = 0
var string struct_lastBreak = na
var BosState bosH = BosState.new()
```

- [ ] **Step 2: Set it in the high-break confirm arm**

Match:
```pine
		if _rH == 2
			f_structDrawBreak(structLastHigh, structHighBar, struct_trend == -1, true)
			struct_trend := 1
			structHighResolved := true
```
Replace with:
```pine
		if _rH == 2
			bool _isCh = struct_trend == -1
			f_structDrawBreak(structLastHigh, structHighBar, _isCh, true)
			struct_lastBreak := _isCh ? "CHoCH" : "BOS"
			struct_trend := 1
			structHighResolved := true
```

- [ ] **Step 3: Set it in the low-break confirm arm**

Match:
```pine
		if _rL == 2
			f_structDrawBreak(structLastLow, structLowBar, struct_trend == 1, false)
			struct_trend := -1
			structLowResolved := true
```
Replace with:
```pine
		if _rL == 2
			bool _isCh = struct_trend == 1
			f_structDrawBreak(structLastLow, structLowBar, _isCh, false)
			struct_lastBreak := _isCh ? "CHoCH" : "BOS"
			struct_trend := -1
			structLowResolved := true
```

- [ ] **Step 4: Static self-review** — `_isCh` is the exact boolean previously passed inline as `isChoch`; behavior of the draw/trend is unchanged, only `struct_lastBreak` is newly recorded. `_isCh` is scoped to each arm (separate `if` blocks) so the duplicate name is fine.

- [ ] **Step 5: Compile check** — paste → Add to Chart with `ENABLE_STRUCTURE` on. Expected: no errors; BOS/CHoCH still draw exactly as before.

- [ ] **Step 6: Commit**
```bash
git add merged_indicator.pine
git commit -m "feat(dashboard): record struct_lastBreak in the structure driver"
```

---

## Task 3: Dashboard block (inputs + helpers + table + populate)

**Files:** Modify `merged_indicator.pine` — insert at end, after the PDA-scanner trigger and **before** `var label _tfWarning=na`

**Why here:** every value read (`_pdaHi/_pdaLo`, `_prevMidDayHi/Lo`, `_secWeekHi/Lo`, `_secMonthHi/Lo`, `struct_trend`, `struct_lastBreak`, `eqhPools/eqlPools`, the `sh_hist*` arrays, `kz_nyHour/kz_nyMin`, `f_inSession`) is already defined above this point; placing the ㉖ inputs here also renders them after ㉕.

- [ ] **Step 1: Insert the full dashboard block**

Match:
```pine
if ENABLE_PDA_SCANNER
	f_pdaScanner()

var label _tfWarning=na
```
Replace with:
```pine
if ENABLE_PDA_SCANNER
	f_pdaScanner()

// ===== ㉖ Dashboard =====
var string dash_pos  = input.string("Top Right", "Position", options=["Top Right", "Top Left", "Bottom Right", "Bottom Left"], group="㉖ Dashboard")
var string dash_size = input.string(size.small, "Text size", options=[size.tiny, size.small, size.normal], group="㉖ Dashboard")
var color  dash_bg   = input.color(color.new(color.black, 20), "Background", group="㉖ Dashboard", inline="d1")
var color  dash_txt  = input.color(color.white, "Text", group="㉖ Dashboard", inline="d1")

// Thread the nearest level above (_aP/_aN) and below (_bP/_bN) the close with one candidate.
f_dashNear(float _p, string _nm, float _aP, string _aN, float _bP, string _bN) =>
	float _ap = _aP
	float _bp = _bP
	string _an = _aN
	string _bn = _bN
	if not na(_p)
		if _p > close and (na(_ap) or _p < _ap)
			_ap := _p
			_an := _nm
		if _p < close and (na(_bp) or _p > _bp)
			_bp := _p
			_bn := _nm
	[_ap, _an, _bp, _bn]

// Consider the newest (index 0) level of a session-H/L array if present and un-mitigated.
f_dashShArr(array<SHLevel> _arr, string _nm, float _aP, string _aN, float _bP, string _bN) =>
	float _ap = _aP
	float _bp = _bP
	string _an = _aN
	string _bn = _bN
	if _arr.size() > 0
		SHLevel _l = _arr.get(0)
		if not na(_l.price) and not _l.mitigated
			[_ap, _an, _bp, _bn] = f_dashNear(_l.price, _nm, _ap, _an, _bp, _bn)
	[_ap, _an, _bp, _bn]

_dashPosCnst = switch dash_pos
	"Top Left"     => position.top_left
	"Bottom Right" => position.bottom_right
	"Bottom Left"  => position.bottom_left
	=> position.top_right
var table dashTbl = table.new(_dashPosCnst, 2, 5, border_width=1)

if ENABLE_DASHBOARD and barstate.islast
	// --- Bias (premium/discount vs dealing-range EQ) ---
	string _biasTxt = "—"
	color _biasCol = dash_bg
	if not na(_pdaHi) and _pdaHi > _pdaLo
		float _pct = (close - _pdaLo) / (_pdaHi - _pdaLo) * 100
		bool _prem = _pct >= 50
		_biasTxt := (_prem ? "Premium " : "Discount ") + str.tostring(_pct, "#") + "%"
		_biasCol := _prem ? color.new(color.red, 40) : color.new(color.green, 40)
	// --- Structure ---
	string _structTxt = "—"
	color _structCol = dash_bg
	if ENABLE_STRUCTURE and struct_trend != 0
		_structTxt := (struct_trend == 1 ? "Bull" : "Bear") + (na(struct_lastBreak) ? "" : " · " + struct_lastBreak)
		_structCol := struct_trend == 1 ? color.new(color.green, 40) : color.new(color.red, 40)
	// --- Nearest untapped liquidity ---
	float _aP = na
	string _aN = ""
	float _bP = na
	string _bN = ""
	if ENABLE_LIQUIDITY
		[_aP, _aN, _bP, _bN] = f_dashNear(_prevMidDayHi, "PDH", _aP, _aN, _bP, _bN)
		[_aP, _aN, _bP, _bN] = f_dashNear(_prevMidDayLo, "PDL", _aP, _aN, _bP, _bN)
		[_aP, _aN, _bP, _bN] = f_dashNear(_secWeekHi, "PWH", _aP, _aN, _bP, _bN)
		[_aP, _aN, _bP, _bN] = f_dashNear(_secWeekLo, "PWL", _aP, _aN, _bP, _bN)
		[_aP, _aN, _bP, _bN] = f_dashNear(_secMonthHi, "PMH", _aP, _aN, _bP, _bN)
		[_aP, _aN, _bP, _bN] = f_dashNear(_secMonthLo, "PML", _aP, _aN, _bP, _bN)
	if ENABLE_SESSION_HL
		[_aP, _aN, _bP, _bN] = f_dashShArr(sh_histAsiaH, "Asia H", _aP, _aN, _bP, _bN)
		[_aP, _aN, _bP, _bN] = f_dashShArr(sh_histAsiaL, "Asia L", _aP, _aN, _bP, _bN)
		[_aP, _aN, _bP, _bN] = f_dashShArr(sh_histLonH, "London H", _aP, _aN, _bP, _bN)
		[_aP, _aN, _bP, _bN] = f_dashShArr(sh_histLonL, "London L", _aP, _aN, _bP, _bN)
		[_aP, _aN, _bP, _bN] = f_dashShArr(sh_histNyamH, "NY AM H", _aP, _aN, _bP, _bN)
		[_aP, _aN, _bP, _bN] = f_dashShArr(sh_histNyamL, "NY AM L", _aP, _aN, _bP, _bN)
		[_aP, _aN, _bP, _bN] = f_dashShArr(sh_histNypmH, "NY PM H", _aP, _aN, _bP, _bN)
		[_aP, _aN, _bP, _bN] = f_dashShArr(sh_histNypmL, "NY PM L", _aP, _aN, _bP, _bN)
	if ENABLE_EQHL
		if eqhPools.size() > 0
			for i = 0 to eqhPools.size() - 1
				LiqPool _p = eqhPools.get(i)
				if na(_p.sweep) or _p.sweep.phase != 2
					[_aP, _aN, _bP, _bN] = f_dashNear(_p.price, "EQH", _aP, _aN, _bP, _bN)
		if eqlPools.size() > 0
			for i = 0 to eqlPools.size() - 1
				LiqPool _p = eqlPools.get(i)
				if na(_p.sweep) or _p.sweep.phase != 2
					[_aP, _aN, _bP, _bN] = f_dashNear(_p.price, "EQL", _aP, _aN, _bP, _bN)
	string _upTxt = na(_aP) ? "—" : "↑ " + _aN + " " + str.tostring(_aP, format.mintick)
	string _dnTxt = na(_bP) ? "—" : "↓ " + _bN + " " + str.tostring(_bP, format.mintick)
	// --- Killzone (recomputed locally) ---
	string _kzTxt = "Dead"
	if timeframe.isintraday
		if kz_showAsian and f_inSession(kz_nyHour, kz_nyMin, kz_asianStart, 0, kz_asianEnd, 0)
			_kzTxt := "Asian"
		if kz_showLondon and f_inSession(kz_nyHour, kz_nyMin, kz_londonStart, 0, kz_londonEnd, 0)
			_kzTxt := "London"
		if kz_showNYAM and f_inSession(kz_nyHour, kz_nyMin, kz_nyamStart, kz_nyamStartM, kz_nyamEnd, 0)
			_kzTxt := "NY AM"
		if kz_showNYPM and f_inSession(kz_nyHour, kz_nyMin, kz_nypmStart, kz_nypmStartM, kz_nypmEnd, 0)
			_kzTxt := "NY PM"
		if kz_showSBAM and f_inSession(kz_nyHour, kz_nyMin, kz_sbamStart, 0, kz_sbamEnd, 0)
			_kzTxt := "Silver Bullet"
		if kz_showSBPM and f_inSession(kz_nyHour, kz_nyMin, kz_sbpmStart, 0, kz_sbpmEnd, 0)
			_kzTxt := "Silver Bullet"
	// --- Paint ---
	table.cell(dashTbl, 0, 0, "Bias",      text_color=dash_txt,     text_size=dash_size, bgcolor=dash_bg)
	table.cell(dashTbl, 1, 0, _biasTxt,    text_color=color.white,  text_size=dash_size, bgcolor=_biasCol)
	table.cell(dashTbl, 0, 1, "Structure", text_color=dash_txt,     text_size=dash_size, bgcolor=dash_bg)
	table.cell(dashTbl, 1, 1, _structTxt,  text_color=color.white,  text_size=dash_size, bgcolor=_structCol)
	table.cell(dashTbl, 0, 2, "Liq ↑",     text_color=dash_txt,     text_size=dash_size, bgcolor=dash_bg)
	table.cell(dashTbl, 1, 2, _upTxt,      text_color=dash_txt,     text_size=dash_size, bgcolor=dash_bg)
	table.cell(dashTbl, 0, 3, "Liq ↓",     text_color=dash_txt,     text_size=dash_size, bgcolor=dash_bg)
	table.cell(dashTbl, 1, 3, _dnTxt,      text_color=dash_txt,     text_size=dash_size, bgcolor=dash_bg)
	table.cell(dashTbl, 0, 4, "Killzone",  text_color=dash_txt,     text_size=dash_size, bgcolor=dash_bg)
	table.cell(dashTbl, 1, 4, _kzTxt,      text_color=dash_txt,     text_size=dash_size, bgcolor=dash_bg)

var label _tfWarning=na
```

- [ ] **Step 2: Static self-review** — every read symbol is defined earlier in the file; `f_dashNear`/`f_dashShArr` are defined before the build block; the `[_aP,_aN,_bP,_bN] = f_dash…(…)` tuple-reassignment pattern matches the file's existing `_htf_traceUpd` usage; `LiqPool`/`SHLevel`/`SweepState` types exist. Tabs (not spaces) for indentation.

- [ ] **Step 3: Compile check** — paste → Add to Chart. **Watch the token count** — this is the heaviest single addition and the script is near the ~100K ceiling. If it errors on tokens, trim: drop the four NY-Pre-AM / NY-Lunch session arrays (already excluded) and, if still tight, the EQHL loops; report the error.
  - Other watch-items: `table.new(_dashPosCnst, …)` accepting a `switch`-derived position; `str.tostring(_pct, "#")` formatting.

- [ ] **Step 4: Manual verify (spec §10)** — turn `ENABLE_DASHBOARD` on:
  - Table appears in the chosen corner, 5 rows; stays put on scroll/zoom.
  - **Bias** = price vs dealing-range EQ (flip `pda_range` → value changes; ≥50% shows Premium, red tint; else Discount, green).
  - **Structure** = Bull/Bear + last BOS/CHoCH; turn `ENABLE_STRUCTURE` off → `—`.
  - **Liq ↑/↓** = nearest un-mitigated/un-swept level each side; toggle `ENABLE_LIQUIDITY`/`ENABLE_EQHL`/`ENABLE_SESSION_HL` off → those candidates drop out.
  - **Killzone** = matches the active shading; `Dead` outside zones.
  - `ENABLE_DASHBOARD` off → no table, no other change.

- [ ] **Step 5: Commit**
```bash
git add merged_indicator.pine
git commit -m "feat(dashboard): bias/confluence table.new readout (gated ENABLE_DASHBOARD)"
```

---

## Task 4: Docs

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: Add the module to the section layout**

After the "9c. Market Structure" line, add:
```markdown
13b. **Dashboard** — gated `ENABLE_DASHBOARD` (default off) corner `table.new` (group ㉖); read-only confluence readout (premium/discount vs dealing-range EQ, structure trend + last BOS/CHoCH via `struct_lastBreak`, nearest untapped liquidity ↑/↓ via `f_dashNear`/`f_dashShArr`, active killzone via `f_inSession`). Populated on `barstate.islast` only; each row degrades to `—` when its source module is off.
```

- [ ] **Step 2: Commit**
```bash
git add CLAUDE.md
git commit -m "docs(dashboard): document the Dashboard module"
```

---

## Self-Review (plan author)

**Spec coverage:** §2 form/gating → Tasks 1, 3 ✓; §3 rows (Bias, Structure, Liq ↑/↓, Killzone) → Task 3 build block ✓; §4 `f_dashNear` scan over PD/PW/PM + newest session H/L + EQHL → Task 3 ✓; §5 `struct_lastBreak` hook → Task 2 ✓; §6 inputs (㉖ + ENABLE_DASHBOARD) → Tasks 1, 3 ✓; §7 placement anchors → Tasks 1–3 ✓; §8 edge `—` degradation → Task 3 (guards + na checks) ✓; §9 budget/repaint (`barstate.islast`, no new security) → Task 3 ✓; §10 verification → Task 3 Step 4 ✓.

**Placeholder scan:** none — every code step is complete Pine; verify steps are concrete checks.

**Type consistency:** `f_dashNear(float,string,float,string,float,string)→[float,string,float,string]` and `f_dashShArr(array<SHLevel>,string,float,string,float,string)→[…]` are called with matching arity everywhere; `struct_lastBreak` (string) is declared in Task 2 and read in Task 3; `_pdaHi/_pdaLo`, `eqhPools/eqlPools`, `sh_hist*`, `kz_*`, `f_inSession` are all pre-existing symbols.
