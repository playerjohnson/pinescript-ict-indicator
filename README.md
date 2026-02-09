# Pine Script v6 — Merged ICT Indicator

A comprehensive, performance-optimised Pine Script v6 indicator that merges multiple ICT (Inner Circle Trader) tools into a single overlay.

## Features

| Section | Feature | Toggle |
|---------|---------|--------|
| A | Hourly Open & Session Separator | `ENABLE_HOURLY_OPEN` |
| A2 | Hourly Order Blocks (bullish/bearish with mitigation) | `ENABLE_ORDER_BLOCKS` |
| B | FVG, Volume Imbalance, GAPs, Implied FVG, Inverse FVG, Liquidity Voids | `ENABLE_IMBALANCES` |
| C | NWOG / NDOG (New Week/Day Opening Gap) | `ENABLE_NWOG_NDOG` |
| D | HTF Candles with traces & imbalances | `ENABLE_HTF_CANDLES` |
| F | Killzones — Asian, London, NY AM/PM, Silver Bullet | `ENABLE_KILLZONES` |
| G | Previous Session Highs/Lows (Asia, London, NY) | `ENABLE_SESSION_HL` |
| H | PDH/PDL, PWH/PWL, PMH/PML Liquidity Levels | `ENABLE_LIQUIDITY` |

## Settings

21 input groups (`⓪`–`⑳`) with inline controls. Master toggles in group `⓪` disable entire sections at zero runtime cost.

## Performance

- **12 unified loops** in Section B (consolidated from 39 in the original)
- **Create-once, update-via-setters** pattern for Session H/L and Liquidity drawings (eliminates 48 delete+new ops per bar)
- `barstate.isconfirmed` guards on all extend/mitigate loops
- OrderBlock UDT consolidation with auto-prune
- 8 master section toggles — disabled sections have zero per-bar cost
- 7 `request.security` calls total (4 NWOG/NDOG + 3 Liquidity D/W/M)

## Installation

1. Open [TradingView](https://www.tradingview.com) → Pine Editor
2. Paste the contents of `merged_indicator.pine`
3. Click **Add to Chart**

## Credits

Built on top of work by:
- **Vulnerable_human_x** — ICT Gaps, Volume & Price Imbalances
- **fadizeidan** — NWOG/NDOG, HTF Candles

Licence: Mozilla Public License 2.0
