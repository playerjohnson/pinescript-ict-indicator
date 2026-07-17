# TradingView Event Logger

Collects every webhook the indicator emits (sweeps, BOS/CHoCH, SMT, mitigations, plus the
`CTX` per-bar-close heartbeat) into Supabase, so setup expectancy can be measured instead
of guessed. Target project: **playerjohnson's Project** (`jgvlpxbfvqavhkotggwj`).

## Components

| Piece | Where | What it does |
|---|---|---|
| `migrations/20260711201903_tv_event_logger.sql` | Postgres | `tv_events` (RLS-locked, service-role-only; one-CTX-per-bar unique index), `tv_webhook_config` (holds the URL token, generated in-DB), `tv_event_outcomes` + `tv_bucket_stats` views |
| `functions/tv-webhook/index.ts` | Edge Function | Validates `?token=` (self-healing on rotation), validates payload, inserts into `tv_events`; treats duplicate CTX bars as success |
| `config.toml` | CLI config | Persists `verify_jwt = false` for `tv-webhook` — **do not deploy without it** (see below) |
| `wh_heartbeat` input (㉑, `merged_indicator.pine`) | Indicator | Emits the `CTX` event once per bar close: close price + ㉘ bias/scores + killzone flag. The outcome views join every other event against these bars |

## Deploy (once)

1. Apply the migration (MCP `apply_migration` or dashboard SQL editor). **Must be applied before
   the function receives traffic** — the function reads `tv_webhook_config` on first request.
2. Deploy the function: `supabase functions deploy tv-webhook --project-ref jgvlpxbfvqavhkotggwj`
   (reads `verify_jwt = false` from `config.toml`), or via MCP `deploy_edge_function` with
   `verify_jwt: false` **explicitly**. ⚠️ Redeploying with JWT verification on will 401 every
   TradingView POST at the gateway and silently kill ingestion.
3. Read the token (dashboard SQL, never commit it): `select token from tv_webhook_config;`
   Rotation (`update tv_webhook_config set token = ...`) takes effect without a redeploy; warm
   instances accept the old token only until the first request carrying the new one.

## TradingView setup

1. Add the indicator; enable **Webhook Alerts** (`wh_enable`), **Context Heartbeat** (`wh_heartbeat`),
   and **Setup Score** (`ENABLE_SETUP` — without it `score_l`/`score_s` log as 0; `bias_dir` still
   populates on live bars if the Dashboard is enabled, since the live bar is the last bar).
2. Create ONE alert: condition = this indicator → **"Any alert() function call"**,
   webhook URL = `https://jgvlpxbfvqavhkotggwj.supabase.co/functions/v1/tv-webhook?token=<token>`.
3. **One alert per (symbol, timeframe).** A second chart of the same series would double-log
   events; duplicate CTX bars are rejected by the unique index (harmless), but duplicate
   sweep/structure events would double-count in the stats.
4. Webhook URLs need any paid TradingView plan (Essential and above). Alert *expiry*: open-ended
   alerts need Premium — on lower tiers alerts expire (~2 months), so recreate them or collection
   silently stops.

## Reading the data

- Raw feed: `select * from tv_events order by id desc limit 50;`
- Per-event forward closes (+4/+12/+24 bars) with same-bar context: `tv_event_outcomes`.
  `dir` is the event's *predicted* direction: sweeps score as reversals, BOS/CHoCH as
  continuation breaks, SMT by its own bull/bear side.
- Win rate / avg signed move at 12 bars per event type × killzone: `tv_bucket_stats`

Caveats: alerts only fire on **live** bars (collection is forward-only from alert creation);
`bar_time_ny` is NY-local naive time (join key, not UTC) — for 24/7 symbols the repeated
1 AM hour on the November DST fall-back night is ambiguous (~irrelevant for CME futures, which
are closed then); the known `f_sweepMark` webhook dedup limitation means a same-bar second sweep
can be dropped — treat missing rows as possible. TradingView pauses alerts that error repeatedly
or expire, and requires a response within ~3s (the function does two fast DB round-trips) —
check `select max(received_at) from tv_events;` if data looks stale.
