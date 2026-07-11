// TradingView webhook receiver → public.tv_events
//
// Auth: TradingView cannot send custom headers, so the shared token rides the URL:
//   https://<ref>.supabase.co/functions/v1/tv-webhook?token=<token>
// The token lives in public.tv_webhook_config (RLS locked, service-role only) — rotate it
// with: update tv_webhook_config set token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
// Deploy with verify_jwt = false (custom token auth replaces JWT).

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

let cachedToken: string | null = null;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  if (!cachedToken) {
    const { data, error } = await supabase
      .from("tv_webhook_config")
      .select("token")
      .single();
    if (error || !data) return new Response("config error", { status: 500 });
    cachedToken = data.token;
  }
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (token.length === 0 || token !== cachedToken) {
    return new Response("unauthorized", { status: 401 });
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
    console.error("tv_events insert failed:", error.message);
    return new Response("insert failed", { status: 500 });
  }
  return new Response("ok", { status: 201 });
});
