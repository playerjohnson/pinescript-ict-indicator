# Bias / Confluence Dashboard — Design Spec

**Date:** 2026-06-04
**Status:** Approved design — ready for implementation
**Target:** `merged_indicator.pine` (Pine v6, single file)
**Branch:** `claude/bias-confluence-dashboard`

---

## 1. Goal

A one-glance on-chart **table** summarizing the ICT confluence read so the "do the modules agree?" check is automatic instead of manual. Four rows: **Bias (premium/discount)**, **Structure (trend + last BOS/CHoCH)**, **Nearest untapped liquidity (above & below)**, **Active killzone**. Almost entirely read-only aggregation of existing state. Gated `ENABLE_DASHBOARD` (default off), token-light.

## 2. Form & gating

- A corner **`table.new`** (anchors to a fixed screen corner; survives scroll/zoom; doesn't count against the 500 box/line/label caps).
- Built once with `var table`; cells populated **only on `barstate.isconfirmed and barstate.islast`** (or `barstate.islast`) → zero per-bar churn.
- `ENABLE_DASHBOARD` in group ⓪ (default off, like `ENABLE_EQHL`/`ENABLE_STRUCTURE`). New input group **"㉖ Dashboard"**.

## 3. Rows & data sources

| Row | Value example | Source (reuse) |
|---|---|---|
| **Bias** | `Premium 72%` / `Discount 28%` | `_pdaHi`/`_pdaLo` (global, follow the existing `pda_range` selector). `% = (close − lo)/(hi − lo) × 100`; ≥50% premium else discount |
| **Structure** | `Bull · BOS` / `Bear · CHoCH` | `struct_trend` (1/-1/0) + **new** `var string struct_lastBreak` set in the structure driver |
| **Liquidity ↑** | `↑ PWH 30,690` | nearest untapped level **above** `close` (scan, §4) |
| **Liquidity ↓** | `↓ Asia L 30,641` | nearest untapped level **below** `close` |
| **Killzone** | `London` / `NY AM` / `Dead` | recomputed locally via `f_inSession(kz_nyHour, kz_nyMin, …)` |

Bias/Structure value cells tinted green/red for at-a-glance reading; killzone cell tinted when a zone is live.

## 4. Nearest-untapped-liquidity scan

Runs only on the last bar. One threaded helper tracks the closest level above and below `close` in a single pass:

```pine
// Thread nearest-above (_aP/_aN) and nearest-below (_bP/_bN) with one candidate.
f_dashNear(float _p, string _nm, float _aP, string _aN, float _bP, string _bN) =>
	float _ap = _aP, float _bp = _bP
	string _an = _aN, string _bn = _bN
	if not na(_p)
		if _p > close and (na(_ap) or _p < _ap)
			_ap := _p, _an := _nm
		if _p < close and (na(_bp) or _p > _bp)
			_bp := _p, _bn := _nm
	[_ap, _an, _bp, _bn]
```

Candidates, each wrapped in its `ENABLE_*` guard so disabled modules contribute nothing:
- **PD/PW/PM** (`ENABLE_LIQUIDITY`): `_prevMidDayHi/Lo` "PDH/PDL", `_secWeekHi/Lo` "PWH/PWL", `_secMonthHi/Lo` "PMH/PML".
- **Session H/L** (`ENABLE_SESSION_HL`): the **newest** level (index 0) of each `sh_hist*` array, included only when `not _lvl.mitigated`. (Newest-only keeps it token-light; history levels are stale draws.)
- **EQH/EQL** (`ENABLE_EQHL`): loop `eqhPools`/`eqlPools`, include `_p.price` when `na(_p.sweep) or _p.sweep.phase != 2`.

Output: `↑ <name> <price>` / `↓ <name> <price>`; `—` if no candidate on that side.

## 5. Structure hook (the only module touch)

The structure module currently draws BOS/CHoCH labels but stores no "last break". Add one global and set it on confirm:

- Declare near the structure state globals: `var string struct_lastBreak = na`
- In the structure driver the high-break confirm arm passes `struct_trend == -1` and the low-break arm passes `struct_trend == 1` as the `isChoch` argument to `f_structDrawBreak`. In each arm, capture that boolean into a local `_isCh` and set `struct_lastBreak := _isCh ? "CHoCH" : "BOS"` alongside the existing draw call. Example (high arm):
  ```pine
  if _rH == 2
      bool _isCh = struct_trend == -1
      f_structDrawBreak(structLastHigh, structHighBar, _isCh, true)
      struct_lastBreak := _isCh ? "CHoCH" : "BOS"
      struct_trend := 1
      structHighResolved := true
  ```

Dashboard Structure cell: `struct_trend == 0 ? "—" : (struct_trend == 1 ? "Bull" : "Bear") + (na(struct_lastBreak) ? "" : " · " + struct_lastBreak)`.

## 6. Inputs (group "㉖ Dashboard")

- ⓪: `ENABLE_DASHBOARD = input.bool(false, "Enable Dashboard", group="⓪ Section Toggles")` — after `ENABLE_STRUCTURE`.
- `dash_pos = input.string("Top Right", "Position", options=["Top Right","Top Left","Bottom Right","Bottom Left"], group="㉖ Dashboard")` → mapped to `position.top_right` etc.
- `dash_size = input.string(size.small, "Text size", options=[size.tiny,size.small,size.normal], group="㉖ Dashboard")`
- `dash_bg = input.color(color.new(color.black, 20), "Background", group="㉖ Dashboard", inline="d1")`
- `dash_txt = input.color(color.white, "Text", group="㉖ Dashboard", inline="d1")`

Bias reuses the existing `pda_range` selector (prev day/week/month) — no new range input.

## 7. Placement (anchor text)

- **Toggle** after `var bool ENABLE_STRUCTURE=input.bool(false, "Enable Market Structure (BOS/CHoCH)", …)`.
- **`struct_lastBreak`** declared after `var int   struct_trend = 0`; assignments inside the `if ENABLE_STRUCTURE` driver's two confirm arms.
- **Dashboard inputs + `f_dashNear` + `var table` + build/populate block** at the **end of the script**, after the `if ENABLE_PDA_SCANNER\n\tf_pdaScanner()` block (so ㉖ renders after ㉕ and all read state — `_pdaHi/_pdaLo`, `struct_*`, `eqhPools`, `sh_hist*`, `kz_nyHour/Min` — is already defined).

## 8. Edge handling

- Any unavailable source → that row/side shows `—` (structure off → Structure `—`; no dealing range / `na(_pdaHi)` → Bias `—`; no candidate above/below → that liquidity side `—`).
- `_pdaHi <= _pdaLo` or `na` → Bias `—` (avoid divide-by-zero).
- Non-intraday: the table still builds; time-based rows (killzone) read `Dead`.

## 9. Budget & repaint

- 1 `table` (separate object class; not against the 500 caps). 0 new `request.security`. The scan + cell writes run only on the last bar.
- Read-only of confirmed state; `barstate.islast` gating means no historical repaint of the table (it only reflects the latest bar, which is the intended live readout).
- **Token cost:** the `f_dashNear` threading + ~20 candidate calls + 2 EQHL loops + table setup. Modest; **verify compiled-token headroom on-chart** (script is near the ~100K ceiling). OFF by default → zero cost when disabled. If tight, trim the session-H/L scan to fewer sessions.

## 10. Verification (manual — TradingView only)

1. OFF → no table, no behavior change, compiles clean, acceptable token count.
2. ON → table appears in the chosen corner with 5 cells; values update on the last bar.
3. **Bias** matches price vs the dealing-range EQ (flip `pda_range` → range source changes; % recomputes; ≥50% = Premium).
4. **Structure** shows Bull/Bear + last BOS/CHoCH; turning `ENABLE_STRUCTURE` off → `—`.
5. **Liquidity ↑/↓** point at the nearest un-swept/un-mitigated levels; a level that gets mitigated/swept drops out and the next one shows.
6. **Killzone** matches the active session shading (`Dead` outside zones).
7. Each source toggled off → its row/side degrades to `—`, no error.
8. Scroll/zoom → table stays in its corner.
