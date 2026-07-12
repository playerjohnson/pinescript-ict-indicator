// TradingView webhook receiver → public.tv_events
//
// Auth: TradingView cannot send custom headers, so the shared token rides the URL:
//   https://<ref>.supabase.co/functions/v1/tv-webhook?token=<token>
// The token lives in public.tv_webhook_config (RLS locked, service-role only) — rotate it
// with: update tv_webhook_config set token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
// Rotation self-heals: on a token mismatch the function re-reads the config once before
// rejecting, so the new token works immediately (no redeploy). Caveat: warm instances keep
// accepting the OLD token until the first request bearing the new one refreshes their cache.
// Deploy with verify_jwt = false (custom token auth replaces JWT) — persisted in ../../config.toml.

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

let cachedToken: string | null = null;

async function fetchToken(): Promise<string | null> {
  const { data, error } = await supabase
    .from("tv_webhook_config")
    .select("token")
    .single();
  return error || !data ? null : data.token;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  if (!cachedToken) {
    cachedToken = await fetchToken();
    if (!cachedToken) return new Response("config error", { status: 500 });
  }
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (token.length === 0) {
    return new Response("unauthorized", { status: 401 });
  }
  if (token !== cachedToken) {
    // Token may have been rotated in tv_webhook_config — re-check once before rejecting.
    cachedToken = (await fetchToken()) ?? cachedToken;
    if (token !== cachedToken) {
      return new Response("unauthorized", { status: 401 });
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (typeof payload?.event !== "string" || payload.event.length === 0 || payload.event.length > 100) {
    return new Response("bad payload", { status: 400 });
  }

  const row = {
    event: payload.event,
    ticker: typeof payload.ticker === "string" ? payload.ticker.slice(0, 40) : null,
    timeframe: typeof payload.timeframe === "string" ? payload.timeframe.slice(0, 16) : null,
    price_high: num(payload.price_high),
    price_low: num(payload.price_low),
    close: num(payload.close),
    bar_time_ny: typeof payload.time === "string" ? payload.time.slice(0, 32) : null,
    bias_dir: num(payload.bias_dir),
    score_l: num(payload.score_l),
    score_s: num(payload.score_s),
    in_kz: typeof payload.in_kz === "boolean" ? payload.in_kz : null,
    raw: payload,
  };

  const { error } = await supabase.from("tv_events").insert(row);
  if (error) {
    if (error.code === "23505") {
      // tv_events_ctx_bar_uidx: CTX already logged for this bar (duplicate alert/delivery) — not a failure
      return new Response("duplicate ignored", { status: 200 });
    }
    console.error("tv_events insert failed:", error.message);
    return new Response("insert failed", { status: 500 });
  }
  return new Response("ok", { status: 201 });
});
