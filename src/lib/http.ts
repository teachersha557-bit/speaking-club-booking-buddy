// Small helpers for public JSON API routes (CORS limited to the Netlify site).

const DEFAULT_ORIGINS = ["https://teachershaspeaking.netlify.app"];

export function allowedOrigins(): string[] {
  const raw = typeof process !== "undefined" ? process.env["ALLOWED_ORIGINS"] : undefined;
  const list = (raw ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  return list.length ? list : DEFAULT_ORIGINS;
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const h: Record<string, string> = { Vary: "Origin" };
  if (origin && allowedOrigins().includes(origin.replace(/\/+$/, ""))) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

export function json(request: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...corsHeaders(request), "Cache-Control": "no-store", ...extra } });
}

export function preflight(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

/** Parses JSON or form-encoded bodies into a plain object. */
export async function readBody(request: Request): Promise<{ raw: string; data: Record<string, unknown> }> {
  const raw = (await request.text()).slice(0, 64_000);
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json") || /^\s*[{[]/.test(raw)) {
    try {
      const v = JSON.parse(raw);
      return { raw, data: v && typeof v === "object" && !Array.isArray(v) ? v : { value: v } };
    } catch { /* fall through */ }
  }
  return { raw, data: Object.fromEntries(new URLSearchParams(raw)) };
}

/** Bearer-token check for scheduled jobs (CRON_SECRET on Netlify, LOVABLE_CRON_SECRET on Lovable). */
export async function checkCronAuth(request: Request): Promise<Response | null> {
  const secrets = [process.env["CRON_SECRET"], process.env["LOVABLE_CRON_SECRET"], process.env["LOVABLE_CRON_SECRET_PREVIOUS"]].filter(Boolean) as string[];
  if (!secrets.length) return new Response("Server configuration error: CRON_SECRET missing", { status: 500 });
  const token = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return new Response("Unauthorized", { status: 401 });
  const { createHash, timingSafeEqual } = await import("node:crypto");
  const d = (v: string) => createHash("sha256").update(v, "utf8").digest();
  const ok = secrets.some((s) => timingSafeEqual(d(token), d(s)));
  return ok ? null : new Response("Unauthorized", { status: 401 });
}
