-- TradingView webhook event logger (fed by merged_indicator.pine ㉑ webhook alerts).
-- Target project: playerjohnson's Project (jgvlpxbfvqavhkotggwj) — tv_ prefix namespaces
-- trading tables in this shared project (convention: vo_* = voice-outreach).

create table public.tv_events (
  id           bigint generated always as identity primary key,
  received_at  timestamptz not null default now(),
  event        text not null,          -- "SWEEP PDH BSL", "BOS SSL", "SMT BEAR ES1!", "CTX" (heartbeat) ...
  ticker       text,
  timeframe    text,
  price_high   numeric,
  price_low    numeric,
  close        numeric,
  bar_time_ny  timestamp,              -- indicator emits America/New_York local time with no offset
  bias_dir     smallint,               -- CTX rows only: +1 discount / -1 premium / 0 unknown
  score_l      smallint,               -- CTX rows only: ㉘ Setup Score long side
  score_s      smallint,               -- CTX rows only: ㉘ Setup Score short side
  in_kz        boolean,                -- CTX rows only: killzone active at bar close
  raw          jsonb not null
);
alter table public.tv_events enable row level security;
-- no policies on purpose: only the service-role edge function writes; reads via dashboard SQL / service role
create index tv_events_series_idx on public.tv_events (ticker, timeframe, bar_time_ny);
create index tv_events_event_idx on public.tv_events (event);
-- One CTX row per bar per series: a second alert on the same symbol+timeframe (or a duplicate
-- delivery) would otherwise double the CTX stream and silently halve the outcome-view horizons,
-- which count rows. The edge function treats the unique-violation as success (duplicate ignored).
-- Partial on CTX only: distinct sweep/structure events can legitimately share a name and bar.
create unique index tv_events_ctx_bar_uidx on public.tv_events (ticker, timeframe, bar_time_ny) where event = 'CTX';

-- Single-row config holding the shared webhook token. RLS on, no policies: service-role only.
-- Token generated in-database so it never appears in code or migrations.
create table public.tv_webhook_config (
  id         boolean primary key default true check (id),
  token      text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
alter table public.tv_webhook_config enable row level security;
insert into public.tv_webhook_config (id) values (true);

-- Outcome view: each non-CTX event joined to same-bar context and the closes 4/12/24 CTX bars later.
-- dir = the direction the event predicts price moves NEXT:
--   sweeps are REVERSALS (BSL raid above a high → down -1; SSL raid below a low → up +1),
--   BOS/CHoCH are CONTINUATION breaks (bullish "BSL" break → up +1; bearish "SSL" → down -1),
--   SMT divergences carry their own direction (BEAR → -1, BULL → +1); 0 = non-directional event.
create view public.tv_event_outcomes with (security_invoker = true) as
select
  e.id, e.event, e.ticker, e.timeframe, e.bar_time_ny,
  e.close as entry_close,
  case
    when e.event like 'SWEEP %BSL' then -1
    when e.event like 'SWEEP %SSL' then 1
    when e.event in ('BOS BSL', 'CHoCH BSL') then 1
    when e.event in ('BOS SSL', 'CHoCH SSL') then -1
    when e.event like 'SMT%BEAR%' then -1
    when e.event like 'SMT%BULL%' then 1
    else 0
  end as dir,
  c0.bias_dir, c0.score_l, c0.score_s, c0.in_kz,
  c4.close  as close_p4,
  c12.close as close_p12,
  c24.close as close_p24
from public.tv_events e
left join lateral (
  select bias_dir, score_l, score_s, in_kz from public.tv_events c
  where c.event = 'CTX' and c.ticker = e.ticker and c.timeframe = e.timeframe
    and c.bar_time_ny = e.bar_time_ny
  order by c.id
  limit 1) c0 on true
left join lateral (
  select close from public.tv_events c
  where c.event = 'CTX' and c.ticker = e.ticker and c.timeframe = e.timeframe
    and c.bar_time_ny > e.bar_time_ny
  order by c.bar_time_ny offset 3 limit 1) c4 on true
left join lateral (
  select close from public.tv_events c
  where c.event = 'CTX' and c.ticker = e.ticker and c.timeframe = e.timeframe
    and c.bar_time_ny > e.bar_time_ny
  order by c.bar_time_ny offset 11 limit 1) c12 on true
left join lateral (
  select close from public.tv_events c
  where c.event = 'CTX' and c.ticker = e.ticker and c.timeframe = e.timeframe
    and c.bar_time_ny > e.bar_time_ny
  order by c.bar_time_ny offset 23 limit 1) c24 on true
where e.event <> 'CTX';

-- Starter per-bucket stats at the 12-bar horizon (win = signed move in the event's predicted direction > 0).
create view public.tv_bucket_stats with (security_invoker = true) as
select
  event, in_kz,
  count(*) filter (where close_p12 is not null and dir <> 0)                                            as samples,
  round(avg(case when dir * (close_p12 - entry_close) > 0 then 1.0 else 0.0 end)
        filter (where close_p12 is not null and dir <> 0), 3)                                           as win12,
  round(avg(dir * (close_p12 - entry_close)) filter (where close_p12 is not null and dir <> 0), 2)      as avg_move12
from public.tv_event_outcomes
group by event, in_kz;
