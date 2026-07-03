# ICT Playbook — NQ1! / ES1! Execution with `merged_indicator.pine`

> ## ⚠ Errata — current build (branch `claude/time-based-smt`, 2026-07-03)
> This playbook was written against the pre-review build, then the code was fixed. The following statements below are **superseded**:
>
> 1. **Sweeps and BOS/CHoCH now have native alertconditions** — `Sweep BSL`, `Sweep SSL`, `BOS Bull/Bear`, `CHoCH Bull/Bear` (close-only, non-repainting). Webhooks are no longer the only path; ignore every "no alertcondition exists for sweeps/structure" remark.
> 2. **The ten `…(±) Mitigation` alertconditions are fixed** — they fire once per event at bar close (including on historical bars). The "never use them / latched-forever" warning no longer applies; arm them freely at *Once Per Bar Close*. (Webhook `Mitigated` events are unchanged: intrabar, once per bar-in-zone.)
> 3. **Dashboard Liq ↑/↓ rows are now trustworthy**: they scan *every* archived level (not just the newest per session), cover all six sessions including **Pre-AM** and **Lunch**, source PD/PW/PM from the mitigation-tracked history, and skip both close-through-mitigated **and** sweep-confirmed (⚡TS) levels. The "shortlist, cross-check the chart" caveat is downgraded to ordinary prudence.
> 4. **Display toggles no longer gate signals**: hiding a session/level class (`sh_show*`, `lq_show*`) keeps its mitigation state, sweep detection, webhooks, and alertconditions running — only the drawings disappear. Ignore the "display toggles are signal toggles" warnings.
> 5. **Bias row no longer breaks on gap opens**: outside yesterday's range it reads "Premium/Discount (gap)" from the Midnight Open side, exactly the manual rule Section 1 prescribes — the dashboard now does it for you.
> 6. Short `lq_lookbackDays` values can no longer empty the weekly/monthly arrays (the newest level always survives the age-prune).
>
> Still true and unchanged: level mitigation (your take-profit event) has **no alert**; NWOG/NDOG and killzones have no alerts; each level sweeps at most once; SMT correlation is your responsibility; all lag/repaint numbers in Section 5.

**Instruments:** NQ1! (1 pt = $20, tick 0.25 = $5) and ES1! (1 pt = $50, tick 0.25 = $12.50); MNQ/MES at 1/10th. Execution chart 1m–5m; all times New York. On CME symbols the **Midnight Open line** is a *true 00:00 NY anchor* — the code special-cases `America/Chicago` (`_midnHour = 23`, line 99), so the 23:00 Chicago bar = 00:00 NY. (The "no midnight bar on RTH-only symbols" caveat does not apply to these futures.)

**Read this first — what is NOT in the file:** Order Blocks, Rejection Blocks, and Breaker/Mitigation Blocks **do not exist** in the current `merged_indicator.pine` (removed by commit d2d22ac for token budget; CLAUDE.md is stale). The tradable entry zones you actually have are: **FVG / VI / GAP / Implied FVG / Inverse FVG / Liquidity Void boxes, NWOG/NDOG gaps, and the swept level lines themselves.** There is also no confluence scorer — the ㉕ "PDA Scanner" only draws previous-period EQ/25%/75% lines.

**Alert plumbing (do this once):** the highest-value signals — sweeps, BOS/CHoCH, SMT breaks — have **no `alertcondition` at all**. Set `wh_enable=true` (default **false**, line 35), keep `wh_sweeps` / `wh_structure` / `wh_smt` / `wh_formations` / `wh_mitigations` true, and create **one TradingView alert on "Any alert() function call"** with your webhook/notification. Separately add the `alertcondition` alerts you want (`FVG+`, `FVG-`, `SMT Bull`, `SMT Bear`) set to **Once Per Bar Close**. Never use the ten "… Mitigation" alertconditions (lines 1094–1103) — their flags latch true forever after the first event; the webhook `Mitigated` events are the working path.

---

## 1. The Core Loop (highest-expectancy repeatable sequence)

Every step below names its signal, its alert, and its lag on the execution TF.

| # | Step | Signal (exact) | Alert | Lag |
|---|------|----------------|-------|-----|
| 1 | **Daily bias anchor** | **Midnight Open line** (00:00 NY open, purple). Below it = daily discount → hunt longs; above = premium → hunt shorts. Cross-check the **HTF Candles panel** (default on, 5m→1W) for stacked HTF bodies and unfilled HTF FVGs as the draw. | none — visual | 0 bars; immutable from the 00:00 bar's first tick; never repaints |
| 2 | **Liquidity map** | ⑲ **Previous-session H/L lines** (Asia archives **at 00:00 NY** — the Asia killzone is 20:00–00:00 end-exclusive, so by London the Asia H/L is long since drawn and sweep-armed; London H/L archives on the 05:00 bar; NY AM on the 12:00 bar). ⑳ **PDH/PDL** (archive on the 00:00 NY bar), **PWH/PWL/PMH/PML**. **NWOG/NDOG** zones. | none for level creation | 1 bar after session end / 0 bars after midnight; prices never change |
| 3 | **Timing window** | **Killzone shading**: London 02:00–05:00, NY AM 09:30–12:00, NY PM 13:30–16:00, Silver Bullet 10:00–11:00 / 14:00–15:00 (SB default OFF — enable). All windows end-**exclusive**. | none — clock-based, watch tint or Dashboard Killzone row | 0 — real-time |
| 4 | **Trigger: the raid** | **Confirmed Turtle Soup sweep** (`f_sweepTick`): raid bar wicks through a ⑲/⑳ level and closes back inside (silent), then a later bar **closes beyond the raid bar's opposite extreme** within `sweep_confirmBars` (2). Level line turns yellow, `⚡TS`, `TS↑/TS↓` marker (back-drawn at the raid bar — don't be flattered by hindsight). Optional confluence: **SMT** (Setup C). | webhook **`SWEEP <name> BSL/SSL`** only — no alertcondition | Fires 1–2 confirmed bars after the raid bar closes ≈ 1.5–3 bars after the wick extreme. On 5m: 5–15 min after the raid |
| 5 | **Entry: PD array in the new direction** | **FVG+ / FVG-** formed by the reversal displacement (fires at the close of candle 3; the box + **dashed C.E. (50%) line** are your zone). **Rest a limit at the C.E. or box edge** — do NOT market the sweep confirm: the confirm close is ≥1× the raid bar's full range (typically 1.5–2×+) away from the wick, which roughly halves your R vs a wick-based stop. | alertcondition **`FVG+`/`FVG-`** (Once Per Bar Close) + webhook `FVG± Mitigated` = your fill notification (fires intrabar on first touch) | FVG confirmed 0 bars after candle-3 close; live-bar boxes are previews — never trust one until its bar closes |
| 6 | **Confirmation = hold/add, NOT gate** | **CHoCH** (`f_bosTick`): close strictly beyond the last 5-bar swing + 2 hold closes. It lands **≥7 bars after the structural extreme** — usually after your FVG retrace has started or finished. Worse, a retrace deep enough to fill your FVG can close back inside the broken swing and **cancel the pending CHoCH as an invisible trap** (no marker, no alert). So: enter on sweep + FVG limit; a CHoCH that later prints = hold runners / add. | webhook **`CHoCH BSL/SSL`** / **`BOS BSL/SSL`** only | Breaking close + `struct_holdBars` (2) closes, on a swing that itself confirmed 5 bars late |
| 7 | **Exit at opposing liquidity** | **Dashboard Liq ↑ / Liq ↓** rows give a *shortlist* of the draw — then **visually cross-check the chart lines** (see §3 for why the rows lie). Take profit into the level; watch for `[Mitigated]` grey or a fresh sweep on your target. | mitigation of ⑲/⑳ levels has **no alert** — visual | Mitigation grey flips at the close-through bar, 0 extra lag, sticky |

**Bias-row caveat (step 1):** the Dashboard **Bias row** computes `(close − _pdaLo)/(_pdaHi − _pdaLo)` against **yesterday's** range. On gap-open days (routine on NQ/ES) the % pegs beyond 0/100 and "longs only in Discount" is degenerate. **Rule: while price is outside yesterday's range, take bias from the Midnight Open side only; resume using the Bias row once price re-enters yesterday's range.**

---

## 2. Named Setups

### Setup A — London / NY-AM Killzone Turtle Soup Reversal (the bread-and-butter)

- **Preconditions:** London (02:00–05:00) or NY AM (09:30–12:00) killzone active; an untapped ⑲/⑳ level nearby — for London that is the **Asia H/L (already archived at 00:00 NY)** or PDH/PDL; for NY AM it is the London H/L, overnight-session levels, or PDH/PDL. Price on the wrong side of the Midnight Open relative to the raid direction (e.g., raid of Asia High while price is in daily premium → short).
- **Firing order:** (1) raid bar wicks the level, closes back inside — *nothing prints*; (2) `SWEEP Asia BSL` (or `SWEEP London SSL`, `SWEEP PDH BSL`…) webhook + `⚡TS` + yellow line at the confirm close, 1–2 bars after the raid; (3) `FVG-`/`FVG+` alertcondition on the displacement leg; (4) later `CHoCH SSL/BSL` webhook = hold confirmation.
- **Entry:** limit at the FVG **dashed C.E.**, or the box's near edge if displacement is violent. Your fill notification is the intrabar `FVG- Mitigated` / `FVG+ Mitigated` webhook.
- **Stop:** 2–4 ticks beyond the **raid bar's wick extreme** (NQ: wick + 1–2 pts; ES: wick + 0.5–1 pt). Code-level invalidation: a confirmed close back beyond the swept level (the level would grey `[Mitigated]` if it hadn't already swept) or a confirmed close through the FVG's far edge (Engulf mitigation) — either one, you're out.
- **Target:** opposing shortlist level from **Liq ↑/↓** cross-checked on chart — London reversal targets the opposite Asia extreme or the Midnight Open; NY AM targets London's opposite extreme, PDL/PDH, or the nearest NWOG/NDOG C.E. Typical NQ London range gives 40–100+ pts to the opposite draw against a 10–20 pt stop.
- **Arm:** the single "Any alert() function call" alert (covers `SWEEP …`, `CHoCH …`, all `Mitigated` events) + `FVG+`/`FVG-` alertconditions Once Per Bar Close. **Do not hide level classes you want traded: `sh_show*` and `lq_showPDH/PWH/PMH` are signal toggles — hiding a session or PD/PW/PM class disables its sweep detection and its `SWEEP` webhooks entirely.**

### Setup B — Silver Bullet FVG Continuation (10:00–11:00 NY)

- **Preconditions:** enable `kz_showSBAM` (and `kz_showSBPM`) — both default OFF. Directional bias already established by a 09:30-open drive: a `SWEEP` event on an overnight/London level between 09:30–10:00, or price displacing away from the Midnight Open.
- **Critical level caveat:** during 10:00–11:00 the **live NY AM session has not archived** — it archives on the 12:00 bar. The ⑲ lines and Liq rows labelled "NY AM" are **yesterday's** AM/Lunch levels. For *today's* AM high/low turn on `sh_showCurrent=true` (default off): dotted running H/L lines — but these are **display-only** (they repaint by design, carry no sweep detection, no mitigation, and don't feed the Liq rows). Use them as eyeballs-only targets/context.
- **Firing order:** (1) 09:30–10:00 displacement leg; (2) inside 10:00–11:00 a retrace prints — you want a **fresh `FVG+`/`FVG-`** formed by the drive (fires at candle-3 close, ≈2 bars after the leg's swing); (3) limit at that FVG's C.E.; (4) `FVG± Mitigated` webhook = filled; (5) continuation — a `BOS` webhook in your direction is the hold signal.
- **Entry:** limit at C.E. of the newest same-direction FVG inside the SB window. No sweep required — this is continuation, not reversal.
- **Stop:** beyond the FVG's far edge + 2 ticks (that far-edge confirmed close is exactly what greys/inverts the box in Engulf mode). NQ: typically 8–15 pts on 1m–2m FVGs.
- **Target:** the untapped liquidity the 09:30 drive is pointed at — PDH/PDL, overnight H/L, or the nearest NWOG/NDOG edge; on trend days, trail per §3.
- **Arm:** `FVG+`/`FVG-` alertconditions + the webhook alert. Keep `extendfvgbox` and `HighlightBox` ON (defaults) — the `Mitigated` fill-webhooks only exist while both are on and mitigation type is Engulf/Rebalance.

### Setup C — SMT-Confirmed Sweep Reversal (NQ↔ES crack)

- **Preconditions:** `ENABLE_SMT=true` (default off). On an **NQ1! chart the default `smt_sym1=ES1!` works out of the box** — retarget/disable `smt_sym2=YM1!` only if you don't want Dow noise. On an **ES1! chart set `smt_sym1=NQ1!`**. Costs +1 `request.security` per enabled symbol. The canonical read: at a session high/low, one index makes the higher-high/lower-low and the other refuses — the "crack."
- **The two engines are different and only sometimes coincide:**
  - **⑲/⑳ sweep** (Setup A engine): wick-reject of an *archived session/PD level*, confirmed by close beyond the raid bar's extreme. Webhook `SWEEP <name> BSL/SSL`.
  - **SMT Level-break** (`f_smtBreak`): each symbol tracks **its own most-recent 25-bar pivot** — *not* the ⑲/⑳ level. Fires when exactly one symbol wick-breaks its own reference and the other holds for `sweep_confirmBars` (2) confirmed closes. Fully `barstate.isconfirmed`, never repaints, prints ~2–3 closes after the sweep bar. Webhook `SMT BREAK BEAR <breaker>` / `SMT BREAK BULL <breaker>`; label "SMT <breaker> HH/LL".
- **Protocol when only one fires (common — expect it):**
  - *SMT break fires, no `SWEEP`*: normal whenever the raid bar **closed through** the session level (body-close kills the sweep arm — that's mitigation, not a raid) or the level classes don't line up. Trade it as a valid but slightly weaker trigger: require the FVG entry zone and prefer half size.
  - *`SWEEP` fires, no SMT break*: also normal — the SMT reference is blind to any level **younger than 25 bars** (the reference pivot needs 25 bars to confirm), and a new 25-bar pivot on either symbol re-arms/cancels a pending break. Absence of SMT is *not* evidence against the sweep. Trade Setup A standalone.
  - *Both fire within a few bars*: A+ signal — full size.
- **Pivot-divergence SMT** (`SMT Bear`/`SMT Bull` lines): ≥5 bars (short scale) / ≥25 bars (long scale) after the swing, plus up to 5/25 bars of cross-symbol de-sync, back-drawn to the swings, and can flash/roll back intrabar (no isconfirmed gate). **Context/bias only — never an entry trigger.** Note the `SMT Bull`/`SMT Bear` alertconditions merge both detectors, both scales, both symbols — only the webhook payload tells you what actually fired.
- **Entry / stop / target:** as Setup A (FVG limit; stop beyond the raid/break wick; target opposing liquidity). 
- **Arm:** webhook alert (`SMT BREAK …`, `SWEEP …`) + optionally `SMT Bull`/`SMT Bear` alertconditions at Once Per Bar Close.

### Setup D — NWOG/NDOG Magnet Fade

- **Preconditions:** NWOG (Sunday 18:00 open vs Friday close) and NDOG zones are first-class magnets on NQ/ES; default ON, drawn on the first confirmed bar of the new week/day, levels never repaint. Only the **5 nearest gaps above and 5 below current price** are shown (visibility churns with price — that's cosmetic). The **Event Horizon** dashed midline between the nearest gap above and below is the "no-man's-land" equilibrium; it moves with price by design. NWOG/NDOG C.E. lines are **dotted** (unlike the FVG C.E., which is dashed).
- **The play:** price between gaps seeks the Event Horizon, then the nearer gap edge, then that gap's C.E. Fade the first touch of a fresh (purple/green "new"-colored) gap edge against the daily bias, or use gap edges/C.E.s as profit targets for Setups A–C.
- **Trigger problem + explicit fallback:** gap edges frequently have **no coincident ⑲/⑳ level**, so the sweep engine and structure engine may be *unable to fire there* — no TS, no CHoCH is possible at that price. Fallback rule: either **(a) skip** unless a ⑲/⑳ level happens to sit within a few points of the edge (then run Setup A on that level), or **(b) manual candle rule**: a confirmed bar that wicks through the gap edge and closes back inside the gap by ≥50% of its own range = your raid bar; enter on the next bar, stop 2–4 ticks beyond that wick. No alert exists for this — NWOG/NDOG have **zero alerts** — so it's a chart-watch setup only.
- **Stop:** beyond the far edge of the gap (a full close-through means the magnet failed — note the code **never** greys/mitigates these gaps, so *you* must enforce invalidation manually).
- **Target:** the gap's dotted C.E. first, then the opposite edge, then the Event Horizon / next gap.

---

## 3. Exits — everything that marks a level "taken"

1. **Close-through mitigation grey-out (⑲/⑳)** — a confirmed **close** beyond a level flips it to grey dotted + `[Mitigated]` (wick-through never mitigates; exact-touch close doesn't count). Sticky, 0-lag at that bar's close, **no alert** — watch the line. **Use:** your target level greying while you're in the trade = the draw is consumed; take the rest off. A confirmed close through a level in your favor = permission to hold to the *next* shortlist level.
2. **Sweep marks on your target — one-shot only.** Each level sweeps **at most once** (phase 2 is terminal): a "new `⚡TS` prints at my target = exit into the reversal" rule works **only on never-swept targets**. For a target that already carries `⚡TS`, use a manual rule: any confirmed bar at the target that wicks through and closes back inside by ≥50% of its range = treat as a raid, exit. (Also note sweeps still fire on `[Mitigated]` levels — a re-test `⚡TS [Mitigated]` on your target is a live exit cue.)
3. **Structure flip** — opposing `CHoCH` webhook = trend flip per the code (`struct_trend` only flips on confirmed CHoCH). Hard exit for runners. Remember it's ~2 closes after the breaking close; pair it with (4) for something faster.
4. **Inverse-FVG flips** — **requires `Inversefvgmode=true` (default false)** or these cues never fire. Your entry FVG being confirmed-closed-through flips it to `I.FVG-`/`I.FVG+` (yellow) with the `Inverse.FVG+`/`Inverse.FVG-` alertcondition + webhook — that is the code telling you your PD array failed: exit immediately. Conversely an opposing FVG flipping *into* your direction mid-trade = hold. (Failed inversions are silently deleted — audit by alert log, not chart archaeology.)
5. **EQ crossing (Bias row / ㉕ lines)** — first scale at the dealing-range EQ (50%) of the previous day (`ENABLE_PDA_SCANNER` draws EQ/25/75); the Bias row flipping Premium↔Discount is the same event. Classic ICT: half off at EQ, runners to the opposing external liquidity.
6. **`Mitigated` webhooks as consumption meter** — `FVG±`/`GAP±`/`VI± Mitigated` webhooks fire **once per every bar trading inside a still-unmitigated zone** (no per-zone latch): the **first buzz = your limit filled / target zone tagged; repeated buzzes on consecutive bars = the zone being eaten** — trail behind it. These only exist while `extendfvgbox` + `HighlightBox` are ON with Engulf/Rebalance mitigation (all defaults) — don't turn those off.
7. **Dashboard Liq ↑/↓ — a shortlist, not gospel.** The rows scan only the **newest archived level per session type**, the PD/PW/PM candidates are **raw values, never mitigation-filtered** (an already-raided PDH can still display as nearest draw ↑), and EQH/EQL pools are **never close-through-mitigated** (only sweep-phase-filtered). Always confirm the named level on the chart: is the line still colored (unmitigated), un-yellow (unswept), and actually the nearest? Older session levels the row skipped may sit closer.

**Trailing recipe:** enter at FVG C.E. → stop beyond raid wick → at EQ/first shortlist level, take 50% and move stop behind the entry FVG's far edge → on each new same-direction FVG formation (`FVG+`/`FVG-` alert), trail the stop behind the *previous* FVG's far edge (an Engulf close through it would flip it inverse anyway = exit cue #4) → flat on opposing `CHoCH`, target-level mitigation grey, or the manual raid rule at a swept target.

---

## 4. Repeated-Profit Daily Routine (all times NY)

**One-time settings (deltas from defaults):**

| Setting | Change | Why |
|---|---|---|
| `wh_enable` | **true** (default false) | Master gate for ALL webhook alerts — sweeps/structure/SMT are webhook-only |
| `ENABLE_SMT` | **true** | Setup C; on NQ chart keep `smt_sym1=ES1!`, disable/retarget `smt_sym2=YM1!`; on ES chart set `smt_sym1=NQ1!` |
| `ENABLE_STRUCTURE` | **true** | CHoCH/BOS hold-confirmation + Dashboard Structure row |
| `ENABLE_DASHBOARD` | **true** | Bias / Structure / Liq ↑↓ / Killzone / SMT rows |
| `kz_showSBAM`, `kz_showSBPM` | **true** | Silver Bullet windows (Setup B) |
| `lq_showPMH` | **true** | PMH/PML display AND sweep detection (display toggles are signal toggles) |
| `Inversefvgmode` | **true** | Exit cue #4 never fires without it |
| `ENABLE_EQHL` | optional **true** | EQH/EQL pools + their sweeps; costs drawings; pools confirm 5 bars late |
| `sh_showCurrent` | **true** | Live session H/L for the SB window (display-only, repaints) |
| `sweep_confirmBars` | **leave at 2** | 2→1 changes *selectivity, not latency*: raid+1 confirms fire on the same bar either way; 1 merely deletes the raid+2 cohort — fewer, fastest-only signals. Only drop to 1 if you want that filter |
| `extendfvgbox`, `HighlightBox`, mitigation types | **leave ON / Engulf** | Turning any off silently kills the `Mitigated` fill-webhooks |
| Do NOT turn off `sh_show*` / `lq_show*` classes you trade | — | Hiding a class disables its sweeps + `SWEEP` webhooks |

**TradingView alerts:** one "Any alert() function call" (webhooks) + `FVG+`, `FVG-`, `SMT Bull`, `SMT Bear` alertconditions at Once Per Bar Close.

**The clock:**

- **Sun 18:00** — new week: NWOG prints on the first confirmed bar. Note its edges/C.E. as the week's primary magnet.
- **18:00 daily** — post-halt reopen; NDOG RTH gap (16:14 close vs 18:00 open) prints on intraday charts.
- **00:00** — the pivot moment: Midnight Open line prints (true 00:00 NY on CME), **Asia H/L archives (killzone is 20:00–00:00 end-exclusive)**, PDH/PDL archive, daily dealing range rolls. Mark: which side of Midnight Open, where are Asia H/L, PDH/PDL, nearest NWOG/NDOG.
- **01:45** — pre-London check (Asia H/L is already drawn and sweep-armed): bias = Midnight Open side (Bias row only if price is inside yesterday's range); pick the London raid candidate (Asia H or L / PDH or PDL). Alerts do the watching.
- **02:00–05:00 (London KZ)** — Setup A/C on `SWEEP Asia|PDH|PDL …` + `SMT BREAK …` webhooks. Exit into the opposite Asia extreme / Midnight Open / EQ. London H/L archives on the 05:00 bar.
- **08:30–09:29** — news volatility; NY Pre-AM (07:00–09:30) level building. Re-read Dashboard; identify the 09:30 draw (overnight H/L, London H/L, PDH/PDL, gap C.E.s). If gapped outside yesterday's range, bias = Midnight Open side.
- **09:30–10:00** — opening drive. Setup A/C if it raids a mapped level; otherwise just classify direction.
- **10:00–11:00 (SB AM)** — Setup B continuation. Remember: "NY AM" lines/rows = *yesterday's* until 12:00; today's live H/L = the dotted `sh_showCurrent` lines (eyeballs only).
- **12:00–13:30 (lunch)** — stand down; NY AM H/L archives on the 12:00 bar — today's AM levels are now real, sweep-armed targets for the PM.
- **13:30–16:00 (NY PM KZ), 14:00–15:00 (SB PM)** — Setup A on raids of the AM H/L or PDH/PDL; Setup B in SB PM. Flat by 15:45–16:00.
- **Weekly** — Monday pre-London: confirm PWH/PWL rolled; note the 60-day `lq_lookbackDays` quietly caps monthly history at ~2 levels (raise it if you want deeper PMH/PML).

---

## 5. Honest Limits

- **Everything actionable is late.** Timing ladder vs the actual turn: formation alertconditions (FVG/VI/GAP) = 0 bars from pattern-completion close but 1–2 bars from the extreme; `SWEEP` = 1.5–3 bars after the raid wick (5–15 min on 5m); `SMT BREAK` = ~2–3 closes after the sweep bar; `BOS/CHoCH` = breaking close + 2 hold closes, on a swing that itself confirmed 5 bars late (≥7 bars from the extreme); SMT pivot divergence = 5/25+ bars — context only. Back-drawn markers (`TS↑/↓` on the raid bar, SMT lines at the swings) make every one of these look earlier in hindsight than it fired.
- **Repaint honesty:** printed sweeps, structure breaks, and SMT breaks never repaint (`barstate.isconfirmed` throughout). But live-bar FVG/VI/GAP boxes are previews that can vanish before close; SMT pivot lines can flash and roll back intrabar; the `sh_showCurrent` lines, Event Horizon, Dashboard %, and NWOG nearest-5 visibility all move by design. Drawings can also *silently disappear* via array caps/pruning (e.g., `smt_maxDiv`, `struct_maxBreaks=15`, FVG 15/side) — absence of a mark ≠ absence of an event.
- **Invisible negatives:** structure traps are fully suppressed (no marker, no alert) — no BOS printed does not mean price didn't close through a swing; a failed sweep never drew anything; failed Inverse-FVGs are deleted. Chart archaeology overstates hit rates — audit by alert log.
- **One-shot levels:** each level sweeps at most once and mitigates at most once; repeated raids of the same high give exactly one signal. Re-tests need your manual candle rules.
- **The dashboard advises, it doesn't decide:** Liq rows are an unfiltered shortlist (see §3.7); the Bias row breaks on gap opens; SMT rows show raw fire-counts + last time — **there is no hit-rate metric in the code** despite the docs.
- **What the indicator cannot do:** no position sizing, no risk-per-trade math (you carry the NQ $20/pt vs ES $50/pt translation), no auto-execution (webhooks are notifications/JSON — an external bridge and its risk controls are on you), no correlation checking for SMT (ES1!/YM1! defaults are only meaningful on correlated index charts — your responsibility), no news filter, no per-trade invalidation tracking on NWOG/NDOG (they never mitigate in code).
- **Where discretion is mandatory:** judging displacement quality (BOS has no ATR/displacement filter — a 1-tick drift-break confirms like an impulsive one; a break that holds 2 bars then fully reverses still stands); choosing *which* shortlist level is the true draw; the entire NWOG/NDOG fade trigger (no alerts, manual candle rules); news-window standdown; and deciding when a one-engine-only SMT/sweep disagreement is a skip. The tool paints the map and rings the bell late but honestly — the trade selection, size, and the first 1–2 bars of every turn remain yours.