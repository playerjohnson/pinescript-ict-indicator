# TradingView Event Logger

Collects every webhook the indicator emits (sweeps, BOS/CHoCH, SMT, mitigations, plus the
`CTX` per-bar-close heartbeat) into Supabase, so setup expectancy can be measured instead
of guessed. Target project: **playerjohnson's Project** (`jgvlpxbfvqavhkotggwj`).

## Components

| Piece | Where | What it does |
|---|---|---|
| `migrations/20260711201903_tv_event_logger.sql` | Postgres | `tv_events` (RLS-locked, service-role-only), `tv_webhook_config` (holds the URL token, generated in-DB), `tv_event_outcomes` + `tv_bucket_stats` views |
| `functions/tv-webhook/index.ts` | Edge Function | Validates `?token=`, validates payload, inserts into `tv_events`. Deploy with `verify_jwt = false` (TradingView can't send JWT; the token is the auth) |
| `wh_heartbeat` input (㉑, `merged_indicator.pine`) | Indicator | Emits the `CTX` event once per bar close: close price + ㉘ bias/scores + killzone flag. The outcome views join every other event against these bars |

## Deploy (once)

1. Apply the migration (MCP `apply_migration` or dashboard SQL editor).
2. Deploy `tv-webhook` with `verify_jwt = false`.
3. Read the token (dashboard SQL, never commit it): `select token from tv_webhook_config;`

## TradingView setup (per chart)

1. Add the indicator; enable **Webhook Alerts** (`wh_enable`), **Context Heartbeat** (`wh_heartbeat`),
   and **Setup Score** (`ENABLE_SETUP` — without it `bias_dir`/`score_*` log as 0).
2. Create ONE alert: condition = this indicator → **"Any alert() function call"**, expiry = open-ended,
   webhook URL = `https://jgvlpxbfvqavhkotggwj.supabase.co/functions/v1/tv-webhook?token=<token>`.
3. Webhook URLs require a paid TradingView plan (Pro+).

## Reading the data

- Raw feed: `select * from tv_events order by id desc limit 50;`
- Per-event forward closes (+4/+12/+24 bars) with same-bar context: `tv_event_outcomes`
- Win rate / avg signed move at 12 bars per event type × killzone: `tv_bucket_stats`

Caveats: alerts only fire on **live** bars (collection is forward-only from alert creation);
`bar_time_ny` is NY-local naive time (join key, not UTC); the known `f_sweepMark` webhook dedup
limitation means a same-bar second sweep can be dropped — treat missing rows as possible, not
impossible. TradingView alerts also pause when the alert errors repeatedly or expires — check
`select max(received_at) from tv_events;` if data looks stale.
