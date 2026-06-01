# Code Audit — `merged_indicator.pine`

**Date:** 2026-06-01
**Branch:** `claude/create-ict-rejection-block-7lVbj`
**Scope:** Static audit of the full ~2,600-line Pine v6 indicator + the uncommitted "HTF draw-magnet" change. No automated tests exist (TradingView-only), so this is a static review against Pine v6 semantics: repaint, `request.security`, array bounds, drawing/output limits, and token cost.

Severity legend: 🔴 high · 🟠 medium · 🟡 low/cleanup · 🔵 note. Confidence noted where a claim depends on Pine runtime behavior.

---

## Uncommitted change: HTF draw-magnet (lines 2100–2127)

> **✅ RESOLVED 2026-06-01 — feature REMOVED.** On-chart testing confirmed the magnet cannot snap onto the projected HTF candles: they are `box`/`line` drawing objects (never magnet targets), and the plots render only on real bars, not in the offset region. TradingView's "Snap to indicators" only snaps to plotted *series values* on real bars — not to drawing objects. The 24 plots could not achieve the intended goal, so they (plus the `_hg` helper and `_mc`) were deleted; output count dropped 47→23 of 64. The findings below are retained for the record. To read exact HTF levels, use the built-in **HTF Candle Trace** lines + **Price Label** ([lines 1676-1693](../../merged_indicator.pine#L1676-L1693)).

The change adds 24 near-invisible `plot()` calls exposing each HTF candle's front (most-recent) O/H/L/C so TradingView's price-scale magnet snaps to those levels. **Two of the items below are gates that must be confirmed on a live chart — they decide whether the feature works at all, or crashes — and rank above the cosmetic issue I originally led with.**

### 🟠 M1 (RESOLVED via research 2026-06-01) — Magnet snaps to plot *values*, not to drawing objects, and only with "Snap to indicators" ON
Verified against official TradingView docs (multi-source + adversarial check):
- The magnet **does** snap to indicator **plot() values** — but **only when the user enables "Snap to indicators"** in the Magnet menu (left toolbar). This option shipped March 2025 and is **OFF by default**. ([blog](https://www.tradingview.com/blog/en/magnet-snaps-to-indicators-instantly-50979/))
- It snaps **while drawing with a tool** (with Weak/Strong magnet), to plotted **series values** (MAs, Bollinger Bands are the documented examples).
- It is **not** documented to snap to Pine **drawing objects** (`box.new`/`line.new`/`label.new`); Pine docs treat chart drawing-tools and Pine drawing objects as "unrelated entities."
- These 24 plots carry **no `offset=`**, so they render on **real bars**, not in the `bar_index+offset` projected region where the HTF candle boxes live. `plot()` can only reach the future via a *constant* offset that shifts the whole series uniformly — it cannot place per-candle values out there. ([plots docs](https://www.tradingview.com/pine-script-docs/visuals/plots/))

**Net:** with "Snap to indicators" enabled, the magnet will snap to the HTF O/H/L/C **price levels when drawing on the real chart**. It will **never** snap by hovering on the projected HTF candle boxes (drawings aren't snap targets; plots don't render there). The most likely reason "snap isn't working" is simply that **"Snap to indicators" is off** — that's a one-click UI setting, not a code bug.

### 🟠 M2 (GATE) — Empty-array safety is the only thing between this change and a runtime crash
`_hg(_cs) ? _cs.candles.first().o : na` relies on (a) `_hg` checking `candles.size() > 0` and (b) Pine evaluating only the selected ternary branch at runtime, so `array.first()` never runs on an empty array. This is the standard safe-array idiom (also used at line 1347) and is **probably** fine — but if that short-circuit assumption is wrong, you get an `"array is empty"` runtime error that disables the whole indicator. **Confirm on a chart state where an HTF set is empty:** a freshly loaded symbol before the first HTF candle forms, or enabling a higher HTF that has no history yet. Treat this as a correctness gate, not a non-issue.

### 🟡 M3 — Price-axis / status-line / Data-Window clutter (⚠️ earlier `display=display.pane` advice WITHDRAWN)
`plot()` defaults to `display = display.all`, so the 24 plots add **24 price-axis tags, 24 status-line values, 24 Data Window rows**, and 24 Style-tab entries.
**Do NOT "fix" this with `display.none` or a reduced `display`.** Per the Pine docs, the magnet/"Snap to indicators" reads the value from the **status line / Data Window**; `display.none` removes it there and would **break snapping**. `display.pane` (my earlier suggestion) is in the same danger zone and is withdrawn. The current **transparency-based hiding is correct** — `color.new(color.white, 99)` keeps the series visually invisible *and* still calculated/snappable. The price-axis tags are the **necessary tradeoff** for keeping the magnet working; if the clutter bothers you, hide individual plots from the **Style tab** (which doesn't disable snapping) rather than via `display=`.

### 🟡 M4 — Output-budget pressure
The script makes **47 output-function calls** (24 magnet plots + 1 `bgcolor` + 22 `alertcondition`). TradingView's hard limit is 64, but whether every one of these counts toward it is an inference — `alertcondition`'s contribution in particular I haven't confirmed, so the true figure is somewhere between ~25 and 47 of 64. Either way there's headroom today; just be aware future plot-based features draw from the same pool. Worth a code comment.

### 🟡 M5 — Token cost near the ceiling
CLAUDE.md flags the script as near the ~100K compiled-token limit. 24 `plot()` statements are a non-trivial, repeated addition. If token headroom is tight, consider whether the magnet is worth ~24 plots, or whether fewer levels (e.g. only the nearest 1–2 HTFs) achieve the goal.

### 🟡 M6 — Micro / cosmetic
- `color _mc = color.new(color.white, 99)` (line 2103) is recomputed every bar; make it `var` (negligible, but free).
- The diff also introduced **stray blank lines** at ~1535 and ~1602–1603 that aren't part of the feature — drop them to keep the diff clean.

---

## Pre-existing findings (whole file)

### 🟠 P1 — Stale deleted-drawing references left in arrays (Inverse FVG and FVG→Inverse paths)
In several mitigation branches a box/line drawing is deleted **without removing its element from the backing array**:
- Bull/Bear Inverse FVG: `box.delete(_box); line.delete(_line)` at ~lines 864–866 and ~897–899 — element stays in `bullInvFVG`/`buinvfvgce` (and bear equivalents).
- FVG→Inverse conversion: original FVG box deleted at ~735 and ~798 but not removed from `_bullBoxesFVG`/`_bearBoxesFVG`.

On later bars these arrays are re-iterated and call `box.get_bottom()`/`box.set_*()` on a freed box. In Pine v6 this does **not crash**, but what a getter returns for a deleted box is unverified — if it yields the box's last coordinates rather than `na`, the impact is *wrong* extend/highlight behavior (and a distorted FIFO prune at 909–916, which `array.shift`es the oldest *live* box while dead ones linger), not merely a wasted iteration.
**Fix:** when deleting inside a reverse loop, also `array.remove(arr, i)` (and the paired line array) so the structure stays clean. Confidence: high that the entry is left behind; medium on the severity — verify on a long-running chart with Inverse FVG mode on.

**Same pattern, likely benign:** the GAP section (~lines 461–470) deliberately `array.push`es `na` boxes — on a bullish-gap bar `_gapsbe` is `na` but is still pushed to keep the bull/bear parallel arrays index-aligned. This is harmless (`bar_index == box.get_right(na)` is false, so the `na` entry is skipped) and appears intentional, but it's the same "dead entries in capped arrays" theme — worth a comment so the intent is explicit.

### 🟡 P2 — Leftover debug logging in production
`log.info('dow: {1} |{0}|', …)` at line 2012 fires on **every new HTF candle, for every enabled HTF**. It spams the Pine logs and adds compiled tokens. Remove it.

### 🟡 P3 — `_controlBox2` is dead/redundant work (lines 350–358)
It computes `_boxLow`, `_boxHigh`, `_boxRight` but never uses them, and only acts when `extendallvis` — yet it's *called* only inside `if extendallvis` (lines 441–442) and then re-checks `extendallvis` internally. Simplify to a single guarded `box.set_right` loop (or inline it) and drop the unused locals to save tokens.

### 🟡 P4 — `_htf_ValidTimeframe`: unused computation (line 1722)
`n3 = n1 % n2` is computed and never used. Delete.

### 🟡 P5 — `f_get_line_style` has no default branch (lines 71–75)
Returns `na` for any string outside the three options, which would pass `na` as a line style. All current callers pass option-constrained inputs, so it's safe today, but a default (`=> line.style_solid`) makes it robust and matches the sibling `_htf_LineStyle` (which does have one). Cheap hardening.

### 🟡 P6 — Heavy per-tick drawing churn in `FindImbalance` (lines 1902–1956)
On every realtime/last bar the method (a) deletes and recreates **all** HTF imbalance boxes, and (b) for each FVG, `box.copy()` + `box.delete()` + reassigns the middle candle's body box (lines 1953–1956, a z-order hack). Per tick this creates/deletes up to ~2×(candles) boxes per HTF set. Net object count is stable, but the create/delete rate is high and scales with `max_display` × number of HTFs. Consider only rebuilding when the candle set actually changed, and doing the body-raise once at candle creation rather than every tick. Confidence: medium (perf/limit pressure, not a correctness bug).

### 🟡 P7 — Loose array-bounds guards in `getCloseAtTime`/`getOpenAtTime` (lines 1385, 1387, 1409, 1411)
`if closeAt.size() >= index` should be `> index` for a correct bounds check. It's harmless in practice (the three tuple arrays share a size and `index < size`), but the `>=` form would permit an out-of-range `get(size)` if the invariant ever changed. Tighten to `>`.

### 🔵 P8 — `Add` swaps open/close naming (lines 1290–1306)
`gap.open := c` and `gap.close := o` invert the parameter names. Rendering uses `math.max/min(open, close)`, so the swap is visually harmless, but it's confusing to read and a trap for future edits. Either rename the params or add a comment explaining the intentional swap.

### 🔵 P9 — Asian killzone end at midnight is end-exclusive
With Asian `end = 0`, `f_inSession` makes the session 20:00–23:59 (the 00:00 boundary candle is excluded). This is consistent end-exclusive behavior across all sessions, so likely intended — flagging only so it's a conscious choice.

---

## What looks solid
- `request.security(..., lookahead = barmerge.lookahead_on)` with `[1]`-offset history for NWOG/NDOG/PWH/PWL/PMH/PML is the correct **non-repainting** pattern.
- The reverse-iteration idiom `for i = size - 1 to 0 by 1` is valid Pine (direction is set by start>end; `by` is magnitude), so the mitigation loops iterate newest→oldest as intended.
- Create-once/update-via-setters drawing pattern and `barstate.isconfirmed` guards on mitigation are applied consistently.
- Master `ENABLE_*` toggles gate per-bar cost as documented.

## Suggested fix order
1. **M1** (magnet `display=display.pane`) — most visible user-facing issue from the pending change.
2. **P2** (remove `log.info`) and **M4** (stray blank lines) — trivial, do alongside M1.
3. **P1** (stale array entries) — correctness/robustness, verify on-chart.
4. **P3/P4/P5/P7** — token + robustness cleanups, batch them.
5. **P6** — only if you hit perf/drawing-limit issues in realtime.
