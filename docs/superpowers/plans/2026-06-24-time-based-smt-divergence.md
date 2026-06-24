# Time-Based SMT Divergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a swing-pivot SMT (Smart-Money-Technique) divergence module to `merged_indicator.pine` — detect when the chart symbol and up to two correlated symbols pivot in opposite directions, mark each divergence on the chart, and surface a live readout in the ㉖ Dashboard.

**Architecture:** Deep re-architecture of the LuxAlgo "SMT Divergences" v5 script into this file's idioms. A `SmtState` UDT is threaded by-reference through `f_smtTick` (one instance per symbol × side, exactly like `SweepState`/`f_sweepTick`). The detector draws the divergence line and returns it; the **driver** (a top-level `if ENABLE_SMT` block) owns everything that touches globals — pushing lines, setting per-bar alert flags, building the single merged label per pivot, pruning, and recording the comparison tickers. Chart pivots are computed unconditionally (matching ㉓/㉔); comparison data + comparison pivots live inside the gate (zero cost when disabled).

**Tech Stack:** Pine Script v6, single file `merged_indicator.pine`, TradingView only (no build/test harness). Source spec: `docs/superpowers/specs/2026-06-24-time-based-smt-divergence-design.md`. Base reference: LuxAlgo "SMT Divergences" (technique credit only).

**Branch:** `claude/time-based-smt` (already checked out; cut off `main` at `4e2d890`).

## Global Constraints

- **Pine uses TAB indentation.** Every code block below is tab-indented — preserve tabs exactly. The #1 failure mode is a tab/space mismatch in `old_string`. **Read the exact region first** before every Edit.
- **No compile in this environment.** You cannot run or compile Pine. Each task ends with a static `git diff` self-review against the task's code; the human compiles + verifies on TradingView at the end (spec §12).
- **Token ceiling.** The file is near TradingView's ~100K compiled-token limit. This feature is net-additive; do not add anything beyond what the spec requires.
- **Master-toggle pattern.** `ENABLE_SMT` gates all per-bar cost; disabled = zero cost.
- **Functions cannot assign to globals.** A Pine function may read globals, mutate by-reference objects passed as params, create drawings, and call `alert()` — but it may **not** reassign a global variable. All global mutation (pushing to `smt_lines`/`smt_labels`, setting `smtBullFired`/`smtBearFired`, recording `smt_tk1`/`smt_tk2`) happens in the driver, never inside `f_smtTick`.
- **Constant-gate rule.** `ENABLE_SMT` and `smt_useSym*` are `input.*` constants, so gating `request.security`/`ta.*` behind them is uniform across bars and safe. `dynamic_requests = true` is already set on the `indicator()` call.
- **Use the Bash tool for git;** if Bash reports `git: command not found`, use the PowerShell tool with `;` instead of `&&`.
- Make **only** the edit(s) in the current task.

---

### Task 1: ⓪ master toggle + ㉑ webhook flag

**Files:**
- Modify: `merged_indicator.pine` (⓪ Section Toggles ~line 39; ㉑ Webhook Alerts ~line 38)

**Produces:** `ENABLE_SMT` (bool), `wh_smt` (bool) — consumed by Task 2.

- [ ] **Step 1: Read** the ⓪ Section Toggles block and the ㉑ Webhook Alerts block to confirm the two anchor lines exactly (tabs/spacing).

- [ ] **Step 2: Add the `ENABLE_SMT` toggle** after `ENABLE_DASHBOARD`.

Match this `old_string` (unique — last line of the ⓪ block):

```
var bool ENABLE_DASHBOARD=input.bool(false, "Enable Dashboard", group="⓪ Section Toggles")
```

Replace with:

```
var bool ENABLE_DASHBOARD=input.bool(false, "Enable Dashboard", group="⓪ Section Toggles")
var bool ENABLE_SMT=input.bool(false, "Enable SMT Divergences", group="⓪ Section Toggles")
```

- [ ] **Step 3: Add the `wh_smt` flag** after `wh_structure`.

Match this `old_string` (unique):

```
var bool wh_structure=input.bool(true, "Structure Alerts", group="㉑ Webhook Alerts", tooltip="BOS / CHoCH break events.")
```

Replace with:

```
var bool wh_structure=input.bool(true, "Structure Alerts", group="㉑ Webhook Alerts", tooltip="BOS / CHoCH break events.")
var bool wh_smt=input.bool(true, "SMT Alerts", group="㉑ Webhook Alerts", tooltip="SMT divergence events.")
```

- [ ] **Step 4: Static self-review**

`git diff` shows exactly two added lines: `ENABLE_SMT` directly after `ENABLE_DASHBOARD` (group `⓪ Section Toggles`, default `false`), and `wh_smt` directly after `wh_structure` (group `㉑ Webhook Alerts`, default `true`). No other change.

- [ ] **Step 5: Commit**

```
git add merged_indicator.pine
git commit -m "feat(smt): add ENABLE_SMT toggle + wh_smt webhook flag"
```

---

### Task 2: SMT engine — inputs, `SmtState`, `f_smtTick`, chart pivots, driver, alertconditions

**Files:**
- Modify: `merged_indicator.pine` (insert one contiguous block immediately **before** the ㉕ PD Array Scanner inputs, ~line 2740)

**Interfaces:**
- Consumes: `ENABLE_SMT`, `wh_smt` (Task 1); existing helpers `_wh_json` (~line 40), `_ho_getSize` (~line 95), `wh_enable` (~line 34); built-ins `fixnan`, `ta.pivothigh/low`, `request.security`, `array.join`, `alert`.
- Produces (all consumed by Task 3 dashboard): globals `smt1H`, `smt1L`, `smt2H`, `smt2L` (`SmtState`, fields `count`/`lastT`), `smt_phN`, `smt_plN` (int), `smt_tk1`, `smt_tk2` (string), `smt_useSym1`, `smt_useSym2` (bool inputs).

- [ ] **Step 1: Read the region** around the ㉕ PD Array Scanner inputs to confirm the anchor line and its exact surroundings. The anchor is the FIRST line of the PDA inputs:

```
var string pda_range=input.string("Previous Day", "Dealing Range", options=["Previous Day", "Previous Week", "Previous Month"], group="㉕ PD Array Scanner", tooltip="Range for EQ. Premium/Discount.")
```

Confirm the lines immediately above it belong to the ㉔ Market Structure driver (ending the structure block), so the SMT block lands cleanly between Market Structure and the PD Array Scanner — before the ㉖ Dashboard (which reads SMT state).

- [ ] **Step 2: Insert the SMT engine block.** Match the `old_string` (the PDA anchor line above) and replace with the whole SMT block followed by the original anchor line (so the block lands *before* it). Tabs throughout (the indented bodies use tabs, not spaces):

```
// ═══════════ ㉗ SMT Divergences ═══════════
// Re-architected from LuxAlgo "SMT Divergences" (Pine v5). Divergence technique credit: LuxAlgo.
// Independent re-implementation in this file's idioms (SmtState UDT by-reference, like SweepState/BosState).
var int    smt_pivotLen       = input.int(3, "Pivot Lookback", minval=2, group="㉗ SMT Divergences", inline="smt1")
var bool   smt_useSym1        = input.bool(true, "Symbol 1", group="㉗ SMT Divergences", inline="smt2")
var string smt_sym1           = input.symbol("CME_MINI_DL:ES1!", "", group="㉗ SMT Divergences", inline="smt2")
var bool   smt_useSym2        = input.bool(true, "Symbol 2", group="㉗ SMT Divergences", inline="smt3")
var string smt_sym2           = input.symbol("CBOT_MINI_DL:YM1!", "", group="㉗ SMT Divergences", inline="smt3")
var color  smt_shColor        = input.color(#ff1100, "Swing-High Div", group="㉗ SMT Divergences", inline="smt4")
var color  smt_slColor        = input.color(#2157f3, "Swing-Low Div", group="㉗ SMT Divergences", inline="smt4")
var int    smt_maxDivergences = input.int(20, "Max Divergences", minval=1, maxval=100, group="㉗ SMT Divergences", inline="smt5")
var string smt_labelSize      = input.string("Tiny", "Label Size", options=['Auto', 'Tiny', 'Small', 'Normal', 'Large', 'Huge'], group="㉗ SMT Divergences", inline="smt5")

type SmtState
	float y1    = na
	float symY1 = na
	int   x1    = na
	int   count = 0
	int   lastT = na

var array<line>  smt_lines  = array.new<line>()
var array<label> smt_labels = array.new<label>()
var int      smt_phN = 0
var int      smt_plN = 0
var string   smt_tk1 = na
var string   smt_tk2 = na
var SmtState smt1H   = SmtState.new()
var SmtState smt1L   = SmtState.new()
var SmtState smt2H   = SmtState.new()
var SmtState smt2L   = SmtState.new()

// One (symbol, side) detector for one bar. Mutates st by-reference (like f_sweepTick/f_bosTick).
// Draws the divergence line from the OLD anchor (st.x1/st.y1) BEFORE updating st, fires the webhook,
// and RETURNS the new line (na if none) — the driver pushes it, sets flags, and builds the merged label.
f_smtTick(SmtState st, bool _isHigh, float _y2, float _symY2, string _name) =>
	line _out = na
	if _y2 != _y2[1] and _symY2 != _symY2[1]
		if (_y2 - st.y1) * (_symY2 - st.symY1) < 0
			_out := line.new(st.x1, st.y1, bar_index - smt_pivotLen, _y2, color = _isHigh ? smt_shColor : smt_slColor, style = line.style_solid)
			st.count := st.count + 1
			st.lastT := time
			if wh_enable and wh_smt
				alert(_wh_json(_isHigh ? "SMT BEAR " + _name : "SMT BULL " + _name, _y2, _y2), alert.freq_once_per_bar_close)
		st.symY1 := _symY2
		st.y1 := _y2
		st.x1 := bar_index - smt_pivotLen
	else if (_isHigh and _y2 > _y2[1]) or (not _isHigh and _y2 < _y2[1])
		st.symY1 := na
		st.y1 := _y2
		st.x1 := bar_index - smt_pivotLen
	_out

// Chart pivots — computed UNCONDITIONALLY (ta.* per-bar consistency, matches ㉓/㉔). fixnan holds the last pivot.
float smt_ph = fixnan(ta.pivothigh(smt_pivotLen, smt_pivotLen))
float smt_pl = fixnan(ta.pivotlow(smt_pivotLen, smt_pivotLen))
smt_phN += smt_ph != smt_ph[1] ? 1 : 0
smt_plN += smt_pl != smt_pl[1] ? 1 : 0
bool smtBullFired = false
bool smtBearFired = false

if ENABLE_SMT
	line _l1H = na
	line _l1L = na
	line _l2H = na
	line _l2L = na
	string _n1 = na
	string _n2 = na
	if smt_useSym1
		[h1, l1, tk1] = request.security(smt_sym1, timeframe.period, [high, low, syminfo.ticker])
		float _symPh1 = fixnan(ta.pivothigh(h1, smt_pivotLen, smt_pivotLen))
		float _symPl1 = fixnan(ta.pivotlow(l1, smt_pivotLen, smt_pivotLen))
		_n1 := tk1
		smt_tk1 := tk1
		_l1H := f_smtTick(smt1H, true, smt_ph, _symPh1, tk1)
		_l1L := f_smtTick(smt1L, false, smt_pl, _symPl1, tk1)
	if smt_useSym2
		[h2, l2, tk2] = request.security(smt_sym2, timeframe.period, [high, low, syminfo.ticker])
		float _symPh2 = fixnan(ta.pivothigh(h2, smt_pivotLen, smt_pivotLen))
		float _symPl2 = fixnan(ta.pivotlow(l2, smt_pivotLen, smt_pivotLen))
		_n2 := tk2
		smt_tk2 := tk2
		_l2H := f_smtTick(smt2H, true, smt_ph, _symPh2, tk2)
		_l2L := f_smtTick(smt2L, false, smt_pl, _symPl2, tk2)
	if not na(_l1H)
		smt_lines.unshift(_l1H)
		smtBearFired := true
	if not na(_l2H)
		smt_lines.unshift(_l2H)
		smtBearFired := true
	if not na(_l1L)
		smt_lines.unshift(_l1L)
		smtBullFired := true
	if not na(_l2L)
		smt_lines.unshift(_l2L)
		smtBullFired := true
	array<string> _hiNames = array.new<string>()
	if not na(_l1H)
		_hiNames.push(_n1)
	if not na(_l2H)
		_hiNames.push(_n2)
	if _hiNames.size() > 0
		label _lbH = label.new(bar_index - smt_pivotLen, smt_ph, array.join(_hiNames, " | "), style = label.style_label_down, color = color.new(color.white, 100), textcolor = smt_shColor, size = _ho_getSize(smt_labelSize))
		smt_labels.unshift(_lbH)
	array<string> _loNames = array.new<string>()
	if not na(_l1L)
		_loNames.push(_n1)
	if not na(_l2L)
		_loNames.push(_n2)
	if _loNames.size() > 0
		label _lbL = label.new(bar_index - smt_pivotLen, smt_pl, array.join(_loNames, " | "), style = label.style_label_up, color = color.new(color.white, 100), textcolor = smt_slColor, size = _ho_getSize(smt_labelSize))
		smt_labels.unshift(_lbL)
	while smt_lines.size() > smt_maxDivergences * 2
		line.delete(smt_lines.pop())
	while smt_labels.size() > smt_maxDivergences
		label.delete(smt_labels.pop())

alertcondition(smtBullFired, title="SMT Bull", message="SMT Bull {{ticker}} {{interval}}")
alertcondition(smtBearFired, title="SMT Bear", message="SMT Bear {{ticker}} {{interval}}")

var string pda_range=input.string("Previous Day", "Dealing Range", options=["Previous Day", "Previous Week", "Previous Month"], group="㉕ PD Array Scanner", tooltip="Range for EQ. Premium/Discount.")
```

- [ ] **Step 3: Static self-review** — verify each against the spec:
  - The block sits **between** the ㉔ Market Structure driver and the ㉕ PDA inputs, so `SmtState`/`f_smtTick`/the four `var SmtState` instances are all defined **before** the driver uses them, and all SMT globals are defined before the ㉖ Dashboard (later in the file) reads them.
  - `f_smtTick` contains **no** global writes — it only mutates its `st` param, creates a line, calls `alert()`, and returns the line. All `smt_lines`/`smt_labels`/`smtBullFired`/`smtBearFired`/`smt_tk*` writes are in the driver.
  - Chart pivots `smt_ph`/`smt_pl` + the `smt_phN`/`smt_plN` increments are **outside** the gate (unconditional). `smtBullFired`/`smtBearFired` are **non-`var`** (reset to `false` each bar) and declared before the gate.
  - The line is drawn with the OLD `st.x1`/`st.y1` **before** the `st.x1 := …`/`st.y1 := …` updates (draw-before-update).
  - `_hiNames`/`_loNames` are **non-`var`** locals (rebuilt every bar). High-side and low-side label steps are independent (not `if/else`-chained).
  - Prune caps: `smt_lines` at `smt_maxDivergences * 2`, `smt_labels` at `smt_maxDivergences`.
  - The two `alertcondition` calls are at **global scope** (column 0, after the gate) and reference the global `smtBullFired`/`smtBearFired`.
  - Indentation is tabs throughout; the original `pda_range` line is unchanged at the end.

- [ ] **Step 4: Commit**

```
git add merged_indicator.pine
git commit -m "feat(smt): SMT engine — SmtState, f_smtTick, chart pivots, driver, alerts"
```

**Manual verify (deferred to checkpoint):** group ㉗ appears with Pivot Lookback / Symbol 1 / Symbol 2 / colors / Max Divergences / Label Size; with `ENABLE_SMT` on and ES/YM symbols, divergence lines+labels render at swing pivots (spec §12 steps 2–5, 7, 8).

---

### Task 3: ㉖ Dashboard fold-in

**Files:**
- Modify: `merged_indicator.pine` (the ㉖ `table.new` ~line 2912, and the `if ENABLE_DASHBOARD and barstate.islast` block ~lines 2971–2980)

**Interfaces:**
- Consumes (from Task 2): `smt1H`, `smt1L`, `smt2H`, `smt2L` (`.count`, `.lastT`), `smt_phN`, `smt_plN`, `smt_tk1`, `smt_tk2`, `smt_useSym1`, `smt_useSym2`, `ENABLE_SMT`; existing `dash_txt`, `dash_size`, `dash_bg`, `_dashPosCnst`.

- [ ] **Step 1: Read** the ㉖ Dashboard region: the `table.new` line and the trailing `table.cell` rows, to confirm exact text + tabs.

- [ ] **Step 2: Resize the table** so the row count is fixed at creation for the enabled SMT symbols.

Match this `old_string` (unique):

```
var table dashTbl = table.new(_dashPosCnst, 2, 5, border_width=1)
```

Replace with:

```
var table dashTbl = table.new(_dashPosCnst, 2, 5 + (smt_useSym1 ? 1 : 0) + (smt_useSym2 ? 1 : 0), border_width=1)
```

- [ ] **Step 3: Append the SMT rows** after the existing Killzone row. Match this `old_string` (the last two cells of the existing block — unique):

```
	table.cell(dashTbl, 0, 4, "Killzone",  text_color=dash_txt,     text_size=dash_size, bgcolor=dash_bg)
	table.cell(dashTbl, 1, 4, _kzTxt,      text_color=dash_txt,     text_size=dash_size, bgcolor=dash_bg)
```

Replace with (tabs; the new rows use a running `_smtRow` counter so a single-symbol config never writes out of bounds):

```
	table.cell(dashTbl, 0, 4, "Killzone",  text_color=dash_txt,     text_size=dash_size, bgcolor=dash_bg)
	table.cell(dashTbl, 1, 4, _kzTxt,      text_color=dash_txt,     text_size=dash_size, bgcolor=dash_bg)
	int _smtRow = 5
	if smt_useSym1
		string _smtV1 = "—"
		if ENABLE_SMT
			int _smtT1 = math.max(nz(smt1H.lastT, 0), nz(smt1L.lastT, 0))
			float _smtR1h = smt_phN > 0 ? smt1H.count * 1.0 / smt_phN : 0.0
			float _smtR1l = smt_plN > 0 ? smt1L.count * 1.0 / smt_plN : 0.0
			_smtV1 := str.format("SH {0} ({1, number, percent})  SL {2} ({3, number, percent})", smt1H.count, _smtR1h, smt1L.count, _smtR1l) + (_smtT1 > 0 ? " · " + str.format_time(_smtT1, "HH:mm", "America/New_York") : "")
		table.cell(dashTbl, 0, _smtRow, "SMT " + (na(smt_tk1) ? "1" : smt_tk1), text_color=dash_txt, text_size=dash_size, bgcolor=dash_bg)
		table.cell(dashTbl, 1, _smtRow, _smtV1, text_color=dash_txt, text_size=dash_size, bgcolor=dash_bg)
		_smtRow += 1
	if smt_useSym2
		string _smtV2 = "—"
		if ENABLE_SMT
			int _smtT2 = math.max(nz(smt2H.lastT, 0), nz(smt2L.lastT, 0))
			float _smtR2h = smt_phN > 0 ? smt2H.count * 1.0 / smt_phN : 0.0
			float _smtR2l = smt_plN > 0 ? smt2L.count * 1.0 / smt_plN : 0.0
			_smtV2 := str.format("SH {0} ({1, number, percent})  SL {2} ({3, number, percent})", smt2H.count, _smtR2h, smt2L.count, _smtR2l) + (_smtT2 > 0 ? " · " + str.format_time(_smtT2, "HH:mm", "America/New_York") : "")
		table.cell(dashTbl, 0, _smtRow, "SMT " + (na(smt_tk2) ? "2" : smt_tk2), text_color=dash_txt, text_size=dash_size, bgcolor=dash_bg)
		table.cell(dashTbl, 1, _smtRow, _smtV2, text_color=dash_txt, text_size=dash_size, bgcolor=dash_bg)
		_smtRow += 1
```

- [ ] **Step 4: Static self-review**
  - The `table.new` row count is `5 + (smt_useSym1?1:0) + (smt_useSym2?1:0)`; the five existing rows keep indices 0–4 (untouched); SMT rows use the running `_smtRow` (starts 5), so with only `smt_useSym2` enabled its row is **5**, not 6 (no out-of-bounds).
  - SMT value cells use a single `text_color=dash_txt` plus `text_size`/`bgcolor` like the existing rows; counts use `{n, number, percent}` with the `smt_phN/plN > 0` guard; time via `str.format_time(…, "HH:mm", "America/New_York")`.
  - Each value reads `—` unless `ENABLE_SMT` is on; row labels fall back to "SMT 1"/"SMT 2" when `smt_tk*` is `na`.
  - `git diff` touches only the `table.new` line and the dashboard cell block.

- [ ] **Step 5: Commit**

```
git add merged_indicator.pine
git commit -m "feat(smt): fold live SMT readout into the ㉖ Dashboard"
```

**Manual verify (deferred):** spec §12 steps 5, 6, 13 (one row per enabled symbol; SH/SL counts + %, last time; `—` when off; five pre-existing rows unshifted).

---

### Task 4: Docs — CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (the "Custom Types (UDTs)" list; the Section Layout block; the `request.security()` count note under Pine Script Conventions)

- [ ] **Step 1: Read** the three CLAUDE.md regions to confirm exact current text.

- [ ] **Step 2: Add `SmtState` to the UDT list.** Match (confirm exact line first):

```
- `NWOGHelper`, `NWOGSettings`, `Gap`, `OpenGap`, `GapBox` — NWOG/NDOG structures
```

Replace with:

```
- `NWOGHelper`, `NWOGSettings`, `Gap`, `OpenGap`, `GapBox` — NWOG/NDOG structures
- `SmtState` — per-(symbol×side) SMT divergence state (SMT Divergences)
```

- [ ] **Step 3: Add the SMT Section Layout entry** after the `9d. **Dashboard**` entry. Match the END of the existing `9d.` paragraph (confirm its exact final sentence first), then append a new `9e.` entry immediately after it:

```
9e. **SMT Divergences** — gated `ENABLE_SMT` (default off), group ㉗. Swing-pivot SMT re-architected from the LuxAlgo "SMT Divergences" script into this file's idioms: a `SmtState` UDT threaded by-reference through `f_smtTick` (one instance per comparison-symbol × side, like `SweepState`/`f_sweepTick`), comparing the chart symbol's `ta.pivothigh/low` against up to two correlated symbols (`smt_sym1`/`smt_sym2`, e.g. ES/YM) fetched via one gated `request.security` each (`[high, low, syminfo.ticker]`). The detector draws the divergence line and returns it; the `if ENABLE_SMT` driver owns all global writes (line/label arrays, per-bar `smtBullFired`/`smtBearFired` flags for the `alertcondition` pair, the single merged label per pivot, pruning to `smt_maxDivergences`). Chart pivots are computed unconditionally (matching ㉓/㉔); comparison data is gated for zero cost when disabled. A live readout (per-symbol SH/SL counts + hit-rate + last-divergence time) folds into the ㉖ Dashboard. Known limits: same-bar pivot coincidence required between symbols; tracks the running latest pivot per side; correlation is the user's responsibility.
```

- [ ] **Step 4: Update the `request.security()` count note.** Match (confirm exact text):

```
- `request.security()` calls are minimized (currently 8 total) due to performance cost
```

Replace with:

```
- `request.security()` calls are minimized (8 always-on; +2 gated behind `ENABLE_SMT` when both SMT comparison symbols are enabled) due to performance cost
```

- [ ] **Step 5: Static self-review** — `git diff CLAUDE.md` shows only the three additions/edits; no code changed.

- [ ] **Step 6: Commit**

```
git add CLAUDE.md
git commit -m "docs(smt): document SMT Divergences module + UDT + security-call count"
```

---

## Execution notes

- **No per-task compile.** The human compiles + on-chart verifies after Task 3 (spec §12), watching the token meter. Two items are explicitly paste-verify because they cannot be checked locally: (a) the mixed-type `request.security(…, [high, low, syminfo.ticker])` tuple — if TradingView rejects the `string` element, fall back to displaying the raw `smt_sym1`/`smt_sym2` input string for names and drop `tk*` from the tuple; (b) `ta.*` + `request.security` under the constant `ENABLE_SMT`/`smt_useSym*` gates compiling cleanly.
- **Adversarial review.** After Task 2 (the substantive one), run an adversarial Pine-v6 review of the inserted code (function-scope rule, tuple types, by-ref UDT mutation, draw-before-update, prune correctness) and fix any BLOCKER/HIGH before proceeding.
- **Finish:** after on-chart verification, use `superpowers:finishing-a-development-branch` (merge `claude/time-based-smt` → main + push, the established pattern).

## Plan self-review

- **Spec coverage:** §1 decisions → Tasks 1–3; §2 data model → Task 2 (UDT, arrays, counters, instances); §3 inputs → Tasks 1 (toggle) + 2 (㉗ group); §4 security → Task 2 driver; §5 detection + chart-pivot hoist → Task 2; §6 render/label/prune → Task 2 driver; §7 dashboard → Task 3; §8 alerts → Task 2 (`alert()` in `f_smtTick`, `alertcondition` + global flags in driver); §9 repaint/integration → Task 2 self-review; §10 limitations → Task 4 docs; §11 budget → respected (gated security, pruned drawings); §12 verification → manual checkpoint after Task 3. ✔ All covered.
- **Type consistency:** `SmtState` fields (`y1`/`symY1`/`x1`/`count`/`lastT`); `f_smtTick(SmtState, bool, float, float, string) → line`; instances `smt1H/smt1L/smt2H/smt2L`; globals `smt_lines`/`smt_labels`/`smt_phN`/`smt_plN`/`smt_tk1`/`smt_tk2`/`smtBullFired`/`smtBearFired`; inputs `smt_pivotLen`/`smt_useSym1`/`smt_sym1`/`smt_useSym2`/`smt_sym2`/`smt_shColor`/`smt_slColor`/`smt_maxDivergences`/`smt_labelSize` — used identically across Tasks 1–4. ✔
- **Placeholder scan:** none — every code step has complete Pine. ✔
