# Time-Based SMT Divergence — Design Spec

**Goal:** Add a Smart-Money-Technique (SMT) divergence module to `merged_indicator.pine`: detect, at swing pivots, when the chart symbol and a correlated symbol move in **opposite** directions (one makes a higher high / the other doesn't, or the mirror for lows), mark each divergence on the chart, and surface a **live** running readout in the ㉖ Dashboard. Built as a **deep re-architecture** of the LuxAlgo "SMT Divergences" script — the divergence *technique* is reproduced; the *implementation* is independent and follows this codebase's idioms.

**Branch:** `claude/time-based-smt` (cut off `main` after the multi-level-liquidity feature landed at `4e2d890`).

**Base reference:** LuxAlgo "SMT Divergences" (Pine v5). Used as the reference for the divergence technique only. The merged indicator is MPL-2.0; this module is a clean re-implementation (not a verbatim copy), with the technique credited to LuxAlgo in a code comment. **Open item for the user:** confirm attribution wording is acceptable before publishing.

---

## 1. Design decisions

- **SD1 — Detection model:** swing-point SMT (pivot-based), *not* session-anchored and *not* fixed-clock-anchored. Chart symbol is always the primary; it is compared against up to two configurable correlated symbols.
- **SD2 — "Time-based / dynamic":** the module continuously surfaces *where* divergences have occurred over time — each divergence is marked as it forms (multiple, capped history of marks), and a live dashboard readout tracks running counts + the most-recent divergence. This overcomes the base script's limitation of only remembering the single most-recent swing per side.
- **SD3 — Output:** (a) on-chart line + label per confirmed divergence, bounded by a prune cap; (b) live readout **folded into the existing ㉖ Dashboard** (no separate table).
- **SD4 — Architecture:** re-architected into this codebase's idioms — a `SmtState` UDT threaded **by-reference** (per `[[pine-tuple-destructuring-is-declaration]]`), mirroring `SweepState`/`BosState`. The LuxAlgo per-call-site `var` trick is replaced by explicit UDT instances.
- **SD5 — Correctness preservation:** the divergence *test* is ported semantically-identical to LuxAlgo. §5 carries an explicit LuxAlgo→our-code mapping so review can verify the math was not altered by the re-architecture.
- **SD6 — Master toggle:** `ENABLE_SMT` in group ⓪, **default `false`** (consistent with `ENABLE_EQHL`/`ENABLE_STRUCTURE`/`ENABLE_DASHBOARD`; protects the token budget and the shared 500-drawing cap until switched on).
- **SD7 — Zero-cost-when-disabled:** the `request.security` calls and pivot/divergence logic are gated behind `ENABLE_SMT` (and per-symbol use-toggles). `dynamic_requests = true` (already set on the `indicator()` call) permits conditional `request.security`. Gating on constant inputs keeps `ta.*` per-bar behaviour consistent.

---

## 2. Data model

New UDT (placed beside the other state UDTs, after `BosState`):

```
type SmtState
	float y1      = na   // previous confirmed pivot on the CHART symbol
	float symY1   = na   // previous confirmed pivot on the COMPARISON symbol
	int   x1      = na    // bar_index of that previous chart pivot
	int   count   = 0     // running count of divergences detected (this symbol × side)
	int   lastT   = na    // time of the most-recent divergence (dashboard "latest")
```

Four `var SmtState` instances (per comparison symbol × side):
`smt1H, smt1L, smt2H, smt2L`.

Two bounded drawing arrays shared across all four detectors (bull + bear share one global budget, like the imbalance arrays):
`var array<line> smt_lines`, `var array<label> smt_labels`.

Two global chart-swing counters for the dashboard hit-rate (the base's `phN`/`plN`): `var int smt_phN = 0`, `var int smt_plN = 0`, incremented when the chart's `ph`/`pl` change (§5). A detector's divergence rate = `st.count / smt_phN` (highs) or `st.count / smt_plN` (lows).

Comparison-symbol short names `tk1`/`tk2` come from the §4 `request.security` tuple — NOT from `syminfo.ticker`, which only ever returns the *chart* symbol's name.

---

## 3. Inputs (group ㉗ "SMT Divergences") + ⓪ toggle

⓪ Section Toggles:
```
var bool ENABLE_SMT = input.bool(false, "Enable SMT Divergences", group="⓪ Section Toggles")
```

㉗ SMT Divergences:
- `smt_pivotLen` int, default 3, min 2 (own input; independent of ㉓/㉔ — matches the base's `length`).
- `smt_useSym1` bool default true; `smt_sym1` symbol default `"CME_MINI_DL:ES1!"`.
- `smt_useSym2` bool default true; `smt_sym2` symbol default `"CBOT_MINI_DL:YM1!"` (continuous-contract `_DL:` prefixes, matching the base; data-plan availability of these IDs is a paste-time check, noted once here).
- `smt_shColor` (swing-**HIGH** divergence) default `#ff1100`; `smt_slColor` (swing-**LOW** divergence) default `#2157f3` (concrete hex, matching the base). **Side-neutral names on purpose:** the direction read (§8) is swing-high = *bearish*, swing-low = *bullish*, so naming these `bull`/`bear` would invert confusingly. Inputs, drawings, and dashboard are all labelled by SIDE (SH/SL), never bull/bear; only §8's alert/webhook event applies the directional read, stated once there.
- `smt_maxDivergences` int default 20, min 1 (prune cap; the two drawing arrays are a single **global shared budget** across all four detectors — bull+bear+both symbols — per §2/§6). `smt_labels` is capped at `smt_maxDivergences` (one merged label per chart pivot — see §6); `smt_lines` is capped at `smt_maxDivergences * 2` (up to two lines per pivot, one per diverging symbol). Worst-case live drawings ≈ 40 lines + 20 labels at defaults.
- `smt_labelSize` string default "Tiny".
- Divergence lines are drawn **solid** (`line.style_solid`), matching the base — no separate style input (avoids depending on `f_get_line_style`, which switches on glyph strings, not `line.style_*` enums).

---

## 4. Comparison-symbol data + security gating

For each enabled comparison symbol, inside the `ENABLE_SMT` block:
```
[h1, l1, tk1] = request.security(smt_sym1, timeframe.period, [high, low, syminfo.ticker], …)   // only if smt_useSym1
[h2, l2, tk2] = request.security(smt_sym2, timeframe.period, [high, low, syminfo.ticker], …)   // only if smt_useSym2
```
- Fetches `[high, low, syminfo.ticker]`: the comparison symbol's H/L (for pivots) **plus its short name** `tk1`/`tk2` (for labels/dashboard). `syminfo.ticker` evaluated *inside* `request.security` resolves the **foreign** symbol's name — the only way to get it; at chart scope `syminfo.ticker` is the chart symbol only, and it is **not** a callable function (`syminfo.ticker(sym)` is invalid Pine). The base fetched `close` and never used it; we reuse that tuple slot for the name at no extra security cost.
- Same-timeframe (`timeframe.period`) — SMT compares like-for-like swings.
- Repaint: comparison values are the symbol's current-bar high/low; the divergence only *registers* on a confirmed pivot (`smt_pivotLen` bars delayed), so confirmed marks do not repaint. `barstate.isconfirmed` discipline applies to count/drawing mutations.

---

## 5. Detection algorithm (LuxAlgo → ours mapping)

**Chart pivots** `ph`/`pl` = `fixnan(ta.pivothigh(smt_pivotLen, smt_pivotLen))` / `fixnan(ta.pivotlow(...))` are computed **unconditionally at top level** (matching the ㉓/㉔ blocks, which hoist their pivots to silence the *"ta.* should be called on each bar"* warning). On each bar where `ph`/`pl` change, increment `smt_phN`/`smt_plN`. **Comparison pivots** (`ta.pivothigh(h1, …)` etc.) are computed **inside** the `if ENABLE_SMT` gate — they consume the gated `request.security` outputs, the deliberate SD7 trade-off (gating the security calls buys zero-cost-when-disabled). Safe because the gate is a constant input.

Per (symbol, side) detector `f_smtTick(SmtState st, bool isHigh, float y2, float symY2)`:

| LuxAlgo `get_divergence` | Our `f_smtTick` |
|---|---|
| `if y2 != y2[1] and sym_y2 != sym_y2[1]` (both made a new pivot this bar) | same guard |
| `if (y2 - y1) * (sym_y2 - sym_y1) < 0` → divergence: `line.new(...)`, `smt += 1` | same test → push the divergence **line**, `st.count += 1`, `st.lastT := time`, return `fired = true` (the merged **label** is emitted by a separate per-pivot step — §6 — so it must NOT be drawn here) |
| na-seed: on the first pivot, `y1`/`sym_y1` are `na`, so `(y2-y1)*(symY2-symY1)` is `na` and `na < 0` is `false` → no spurious divergence | identical (`SmtState` fields default `na`; the test yields `na`→false on the seed bar, exactly as the base) |
| `sym_y1 := sym_y2`, `y1 := y2`, `x1 := n[length]` | `st.symY1 := symY2`, `st.y1 := y2`, `st.x1 := bar_index - smt_pivotLen` |
| `else if (ph and y2>y2[1]) or (not ph and y2<y2[1])` → reset `sym_y1:=na`, `y1:=y2`, `x1:=n[length]` | same (chart made a new extreme but comparison didn't pivot → re-anchor, no divergence) |
| returns `smt` | returns bool "divergence fired this bar" |

**Draw-before-update ordering:** the divergence line is drawn with the OLD `st.x1`/`st.y1` (the *previous* pivot) **before** they are reassigned to the current pivot — exactly as the base calls `line.new(...)` (line 42) before `x1 := n[length]` (line 48). The line therefore spans previous→current pivot.

Driver calls it 4× when the respective symbol is enabled: `f_smtTick(smt1H, true, ph, symPh1)`, `(smt1L, false, pl, symPl1)`, `(smt2H, …)`, `(smt2L, …)` — exactly the base's four call sites, now explicit UDT instances.

---

## 6. On-chart rendering + drawing budget

**Line — one per diverging symbol, drawn inside `f_smtTick`** (within `barstate.isconfirmed`):
- `line.new(st.x1, st.y1, bar_index - smt_pivotLen, y2, color = isHigh ? smt_shColor : smt_slColor, style = line.style_solid)` — previous pivot → current pivot on the chart symbol. Push to `smt_lines`.

**Label — ONE merged label per chart pivot, drawn by a separate per-side step** (matching the base, which builds a single `"ES | YM"` label after both symbol detectors run):
- The detector does NOT emit labels. After both symbols' same-side detectors have run for a new chart pivot, collect the names (`tk1`/`tk2`) of whichever symbols `fired` into a **non-`var`** local array (rebuilt every bar, like the base's `txt = ''`; a `var` accumulator would wrongly carry tickers across pivots) and, if non-empty, emit **one** `label.new(bar_index - smt_pivotLen, y2, array.join(tickers, " | "), style = isHigh ? label.style_label_down : label.style_label_up, textcolor = isHigh ? smt_shColor : smt_slColor, size = _ho_getSize(smt_labelSize), …)`. Push to `smt_labels`.
- **Why a separate step:** the 4-independent-detector split would otherwise draw two overlapping labels at the identical `(bar_index - smt_pivotLen, y2)` coordinate when both symbols diverge at the same pivot. The merge restores the base's single-label behaviour, using the `fired` bools returned by the two same-side `f_smtTick` calls.
- Run the high-side and low-side label steps **independently** (not `if/else`-chained as the base is), so a bar that confirms both a pivot-high and a pivot-low could render both labels; harmless since a strict-pivot centre bar cannot be both at `smt_pivotLen ≥ 2`.

**Pruning** (the required fix to the base's unbounded-drawing leak): prune oldest while `smt_lines.size() > smt_maxDivergences * 2` and `smt_labels.size() > smt_maxDivergences` (`line.delete`/`label.delete` the shifted entry). Lines and labels are pruned independently because a merged label can cover up to two lines.

---

## 7. Dashboard fold-in (㉖)

The existing ㉖ table is created `table.new(_dashPosCnst, 2, 5)` (merged_indicator.pine ~line 2912) with cells addressed at **literal** row indices 0–4 (Bias, Structure, Liq↑, Liq↓, Killzone; ~lines 2971–2980). **Pine tables are fixed-size at `table.new` — they cannot grow.** So the row-count literal becomes a creation-time constant:
```
table.new(_dashPosCnst, 2, 5 + (smt_useSym1 ? 1 : 0) + (smt_useSym2 ? 1 : 0))
```
SMT rows are appended at **sequential** indices computed from a running counter over the **enabled** symbols — NOT hardcoded 5/6: first enabled symbol → row 5, second enabled → row 6. ⚠️ With only `smt_useSym2` enabled, table height is 6 (valid indices 0–5) and that symbol's row is **5**, not 6 — a hardcoded `6` would be a runtime out-of-bounds error. The five pre-existing rows keep indices 0–4 unchanged. The row count depends only on the **constant** `smt_useSym*` inputs (evaluated once at `var table` creation), **not** on `ENABLE_SMT`. The `table.new` edit must preserve the existing `border_width=1`.

Each SMT row (one per enabled comparison symbol):
- Label cell: `"SMT " + tkN` — the §4 security-tuple short name (`tk1`/`tk2`), **not** `syminfo.ticker(smt_symN)` (invalid for a foreign symbol).
- Value cell — a single, concretely-formatted, **side-labelled** string (table cells have exactly **one** `text_color`, so we do not try to two-tone it):
  ```
  na(_lastT) ? "—" : str.format("SH {0} ({1,number,percent})  SL {2} ({3,number,percent}) · {4}",
      _shCount, smt_phN > 0 ? _shCount / smt_phN : 0,
      _slCount, smt_plN > 0 ? _slCount / smt_plN : 0,
      str.format_time(_lastT, "HH:mm", "America/New_York"))
  ```
  — per-side divergence **count + hit-rate** (rate = divergences / total chart swings, restoring the base's `ph_smt/phN`) + most-recent divergence time (latest), explicit NY timezone. One `text_color = dash_txt`, `text_size = dash_size`, `bgcolor = dash_bg` — matching the existing rows. `_lastT` = the more recent of the symbol's two detectors' `lastT`.
- Populated only when `ENABLE_SMT` is on; reads `—` otherwise — matching ㉖'s existing per-module degrade pattern. **Allocation vs visibility:** the rows are always allocated (size depends on the constant `smt_useSym*`), so the five pre-existing rows never shift; toggling `ENABLE_SMT` only blanks the SMT rows' values, it does not resize the table. The readout is meaningful only when **both** `ENABLE_DASHBOARD` and `ENABLE_SMT` are on; on-chart marks need only `ENABLE_SMT`.

---

## 8. Alerts / webhook

- New `wh_smt` input in group ㉑ (default true), gated by `wh_enable`.
- **Direction mapping — the single source of truth (stated once):** swing-**HIGH** divergence ⇒ **bearish** (`SMT BEAR`); swing-**LOW** divergence ⇒ **bullish** (`SMT BULL`). Matches ICT convention. (This is the *only* place the side→direction read is applied; inputs/drawings/dashboard elsewhere stay side-labelled SH/SL per §3.)
- On each confirmed divergence (fired inside the per-symbol detector, so the diverging symbol's name `tkN` is in scope): `alert(_wh_json(isHigh ? "SMT BEAR " + tkN : "SMT BULL " + tkN, y2, y2), alert.freq_once_per_bar_close)`.
- An `alertcondition` pair (`SMT Bull` / `SMT Bear`) for the non-webhook path, consistent with the existing imbalance `alertcondition`s. Because `alertcondition` lives at **global scope** and cannot read state computed only inside the `if ENABLE_SMT` gate, hoist two global `var bool smtBullFired` / `smtBearFired` flags — reset each bar, set inside the gate on a confirmed divergence (swing-low ⇒ bull, swing-high ⇒ bear) — and reference those globals in the top-level `alertcondition` calls.

---

## 9. Repaint, correctness, integration safety

- Divergence registers only on confirmed pivots → confirmed marks are stable.
- **Chart** pivots (`ph`/`pl`) are computed unconditionally at top level (§5), matching ㉓/㉔ — no `ta.*` consistency concern there. **Comparison** pivots (`ta.pivothigh(h1,…)` etc.) and the two `request.security` calls live inside the `if ENABLE_SMT` (constant-input) branch — uniform across bars, so `ta.*` state stays consistent. **TradingView-verify** that the gated `request.security` + `ta.*` compiles cleanly and behaves (cannot be checked locally — no Pine compiler here).
- No existing global is renamed; SMT is purely additive. PDA Scanner / Dashboard / liquidity untouched except the additive ㉖ rows.

---

## 10. Known limitations (documented, not bugs)

- **Same-bar pivot coincidence** (inherited from LuxAlgo): a divergence is only tested when the chart *and* the comparison symbol register a pivot on the **same bar**. Genuinely correlated index futures usually pivot together at `length=3`, but mismatches are silently skipped.
- **Running latest per side:** like the base, each detector tracks the most-recent pivot pair; it is not a full swing-history graph.
- **Correlation is the user's responsibility:** comparing uncorrelated symbols produces noise.
- **Session/holiday misalignment** between symbols (different trading hours) can create spurious pivots near gaps.
- **Continuous-contract symbol IDs** must be valid on the user's data plan (paste-time check).

---

## 11. Token & drawing-budget impact

- **Security calls:** +2 (to 10 total) when both symbols enabled — but **gated**, so zero when `ENABLE_SMT` is off. Within headroom per the user's "plenty of headroom" token-meter reading after the liquidity build.
- **Drawings:** bounded by `smt_maxDivergences` (default 20) → ≤ ~40 lines (cap ×2, up to two per pivot) + ~20 labels (one merged per pivot) live, well within the shared 500 cap. Pruned, unlike the base.
- **Compiled tokens:** net additive (new UDT + ~4 detector call sites + render + dashboard rows). Re-verify the token meter after paste.

---

## 12. Verification (manual — TradingView only)

1. `ENABLE_SMT` off → no SMT drawings, no ㉗ effect, compiles clean, token meter acceptable.
2. `ENABLE_SMT` on, chart = NQ1!, sym1 = ES1!, sym2 = YM1! → SMT lines+labels appear at swing pivots where the symbols diverge; label names the diverging symbol(s).
3. Swing-high divergence renders in `smt_shColor` with a down-label; swing-low in `smt_slColor` with an up-label.
4. Generate > `smt_maxDivergences` divergences → oldest lines/labels prune off; live count keeps incrementing.
5. Disable `smt_useSym2` → only sym1 divergences detected; one ㉖ SMT row (table is sized for one SMT row).
6. `ENABLE_DASHBOARD` on → ㉖ shows one "SMT <ticker>" row per enabled symbol with `SH/SL` counts + last-divergence time; rows read `—` when `ENABLE_SMT` is off.
7. Webhook: `wh_enable` + `wh_smt` on → `alert()` JSON fires once per confirmed divergence with correct event (`SMT BEAR` for swing-high / `SMT BULL` for swing-low) and symbol.
8. Scroll/zoom + bar-replay → confirmed SMT marks do not repaint.
9. Token meter still within limit with `ENABLE_SMT` on and both symbols active.
10. PDA Scanner, Dashboard confluence rows, liquidity, and session H/L all behave exactly as before (SMT is additive).
11. **Alertcondition entries:** `SMT Bull` and `SMT Bear` appear as selectable conditions in TradingView's alert-creation dialog (the non-`alert()` path).
12. **Same-bar dual-symbol divergence:** force a bar where BOTH comparison symbols diverge at the same chart pivot → exactly **one** merged label (e.g. "ES | YM"), not two overlapping labels; up to two lines may be drawn (one per symbol).
13. **Dashboard regression:** with SMT rows added, confirm the five pre-existing rows (Bias, Structure, Liq↑, Liq↓, Killzone) still render at their correct positions and values (the row-count change did not shift or truncate them).
