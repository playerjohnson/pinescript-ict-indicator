# Pine Script v6 — Merged ICT Indicator

A comprehensive, performance-optimised Pine Script v6 indicator that merges multiple ICT (Inner Circle Trader) tools into a single overlay.

## Features

| Feature | Toggle |
|---------|--------|
| Hourly Open & Session Separator | `ENABLE_HOURLY_OPEN` |
| FVG, Volume Imbalance, GAPs, Implied/Inverse FVG, Liquidity Voids | `ENABLE_IMBALANCES` |
| NWOG / NDOG (New Week/Day Opening Gap) | `ENABLE_NWOG_NDOG` |
| HTF Candles with traces and imbalances | `ENABLE_HTF_CANDLES` |
| Killzones — Asian, London, NY AM/PM/Lunch, Silver Bullet | `ENABLE_KILLZONES` |
| Previous Session Highs/Lows | `ENABLE_SESSION_HL` |
| PDH/PDL, PWH/PWL, PMH/PML Liquidity Levels | `ENABLE_LIQUIDITY` |
| Liquidity Sweeps and Turtle Soup confirmations | `ENABLE_SWEEPS` |
| Equal Highs/Lows and Wick Reversal | `ENABLE_EQHL`, `ENABLE_WICK_REV` |
| Market Structure — BOS/CHoCH | `ENABLE_STRUCTURE` |
| SMT Divergences | `ENABLE_SMT` |
| PD Array Scanner, Setup Score, and Dashboard | `ENABLE_PDA_SCANNER`, `ENABLE_SETUP`, `ENABLE_DASHBOARD` |

## Settings

Numbered input groups (`⓪`–`㉘`) use compact inline controls. Master toggles in group `⓪` gate each feature's runtime work.

## Performance

- **12 unified loops** in the imbalance section (consolidated from 39 in the original)
- **Create-once, update-via-setters** pattern for Session H/L and Liquidity drawings (eliminates 48 delete+new ops per bar)
- `barstate.isconfirmed` guards on all extend/mitigate loops
- Array-backed drawings are capped and pruned to stay within TradingView's 500-object limits
- 15 master section toggles; expensive optional modules default off
- 8 always-on `request.security` calls, plus up to 2 gated SMT comparison-symbol calls

## Installation

1. Open [TradingView](https://www.tradingview.com) → Pine Editor
2. Paste the contents of `merged_indicator.pine`
3. Click **Add to Chart**

## Credits

Built on top of work by:
- **Vulnerable_human_x** — ICT Gaps, Volume & Price Imbalances
- **fadizeidan** — NWOG/NDOG, HTF Candles

Licence: Mozilla Public License 2.0
