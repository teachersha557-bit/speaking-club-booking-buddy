// Server-only clients for BCL, Google Calendar, Gmail and WhatsApp.
// Never import from browser code.
//
// Each Google / WhatsApp call works in one of two modes:
//  - DIRECT (Netlify or any host): your own credentials in environment variables
//      Google:   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
//      WhatsApp: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID
//  - LOVABLE GATEWAY (Lovable hosting): LOVABLE_API_KEY + per-connector keys.
// Direct credentials win when both are present.

const GW = "https://connector-gateway.lovable.dev";

const has = (name: string) => !!process.env[name];
function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

async function readJson(res: Response, label: string) {
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${label} ${res.status}: ${text.slice(0, 500)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

async function gw(connector: string, keyVar: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${GW}/${connector}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env("LOVABLE_API_KEY")}`,
      "X-Connection-Api-Key": env(keyVar),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return readJson(res, connector);
}

// ---------------- Google (OAuth refresh token or Lovable gateway) ----------------
const googleDirect = () => has("GOOGLE_CLIENT_ID") && has("GOOGLE_CLIENT_SECRET") && has("GOOGLE_REFRESH_TOKEN");
let googleToken: { value: string; exp: number } | null = null;

async function googleAccessToken(): Promise<string> {
  if (googleToken && googleToken.exp > Date.now() + 60_000) return googleToken.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: env("GOOGLE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  const j = await readJson(res, "Google token");
  googleToken = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3000) * 1000 };
  return googleToken.value;
}

async function google(api: "calendar" | "gmail", path: string, init: RequestInit = {}) {
  if (googleDirect()) {
    const base = api === "calendar" ? "https://www.googleapis.com" : "https://gmail.googleapis.com";
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await googleAccessToken()}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    return readJson(res, `Google ${api}`);
  }
  return api === "calendar"
    ? gw("google_calendar", "GOOGLE_CALENDAR_API_KEY", path, init)
    : gw("google_mail", "GOOGLE_MAIL_API_KEY", path, init);
}

export const calendarConfigured = () => googleDirect() || (has("LOVABLE_API_KEY") && has("GOOGLE_CALENDAR_API_KEY"));
export const gmailConfigured = () => googleDirect() || (has("LOVABLE_API_KEY") && has("GOOGLE_MAIL_API_KEY"));

// ---------------- BCL ----------------
// Endpoints below follow BCL's public API (api.bcl.my/v1). Webhooks from BCL are
// never trusted on their own: every payment is re-checked with bclGetTransaction.
const BCL = "https://api.bcl.my/v1";
const UA = "TeacherShaSpeakingClub/1.0";
export const BCL_FORM_URL_DEFAULT = "https://teachersha.bcl.my/form/spekaing-club";

/** Can look up transactions (needed to verify any payment). */
export function bclCanVerify() {
  return has("BCL_API_TOKEN");
}
/** Can create a per-booking payment link whose order number is the booking reference. */
export function bclCanCreateLinks() {
  return has("BCL_API_TOKEN") && has("BCL_PORTAL_KEY") && (process.env["BCL_PAYMENT_MODE"] ?? "link") !== "form";
}
/** Back-compat name. */
export const bclConfigured = bclCanVerify;
export function bclFormUrl() {
  return process.env["BCL_FORM_URL"] || BCL_FORM_URL_DEFAULT;
}
export function bclTestMode() {
  return (process.env["BCL_TEST_MODE"] ?? "true").toLowerCase() !== "false";
}

export async function bclCreatePaymentLink(p: {
  reference: string; name: string; email: string; phone: string; amount: number;
}): Promise<string> {
  const res = await fetch(`${BCL}/payment-link`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("BCL_API_TOKEN")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({
      order_number: p.reference,
      amount: p.amount,
      payer_name: p.name,
      payer_email: p.email,
      payer_telephone_number: p.phone,
      portal_key: env("BCL_PORTAL_KEY"),
      let_user_choose_payment: true,
      remarks: `Teacher Sha Speaking Club 4 kelas ${p.reference}`,
    }),
  });
  const j = await readJson(res, "BCL payment link");
  const link = j?.data?.payment_link;
  if (!link) throw new Error("BCL returned no payment link");
  return link;
}

export interface BclVerified {
  found: boolean;
  orderNumber: string;
  isPaid: boolean;
  status: number | null;
  currency: string | null;
  amount: number | null;
  subtotal: number | null;
  payerEmail: string | null;
  statusDescription: string | null;
  raw: unknown;
}

/** Look up one transaction directly with BCL (never trust webhooks/redirects). */
export async function bclGetTransaction(orderNumber: string): Promise<BclVerified> {
  const path = bclTestMode() ? `/transaction/${encodeURIComponent(orderNumber)}` : `/transactions/${encodeURIComponent(orderNumber)}`;
  const res = await fetch(`${BCL}${path}`, {
    headers: { Authorization: `Bearer ${env("BCL_API_TOKEN")}`, Accept: "application/json", "User-Agent": UA },
  });
  const empty = { found: false, orderNumber, isPaid: false, status: null, currency: null, amount: null, subtotal: null, payerEmail: null, statusDescription: null };
  if (res.status === 404) return { ...empty, raw: null };
  const j = (await readJson(res, "BCL lookup"))?.data ?? {};
  if (j.main_data) {
    const m = j.main_data;
    return {
      found: true, orderNumber: m.order_number, isPaid: !!m.is_paid, status: m.status ?? null,
      currency: m.currency ?? null, amount: Number(m.amount), subtotal: Number(m.subtotal_amount),
      payerEmail: m.payer_email ?? null, statusDescription: m.status_description ?? null,
      raw: { order_number: m.order_number, status: m.status, is_paid: m.is_paid, amount: m.amount, subtotal: m.subtotal_amount, currency: m.currency, bayarcash_transaction_id: m.bayarcash_transaction_id },
    };
  }
  const t = j.transaction ?? {};
  // test-mode payment-link lookup: amounts only, currency is always MYR for payment links
  return {
    found: !!t.order_number, orderNumber: t.order_number, isPaid: t.status === 3 || /success|paid/i.test(j.payment_status ?? ""),
    status: t.status ?? null, currency: "MYR", amount: Number(t.amount), subtotal: Number(t.amount),
    payerEmail: t.payer_email ?? null, statusDescription: j.payment_status ?? null,
    raw: { order_number: t.order_number, status: t.status, amount: t.amount, payment_status: j.payment_status },
  };
}

// ---------------- Google Calendar ----------------
const calId = () => encodeURIComponent(process.env["GOOGLE_CALENDAR_ID"] || "primary");
const CAL = () => `/calendar/v3/calendars/${calId()}/events`;

export async function calCreateClassEvent(date: string) {
  const ev = await google("calendar", `${CAL()}?conferenceDataVersion=1&sendUpdates=none`, {
    method: "POST",
    body: JSON.stringify({
      summary: "Teacher Sha Speaking Club",
      description: "Kelas English speaking, 8:00–9:00 PM waktu Malaysia. Each Tuesday has its own Google Meet link.",
      start: { dateTime: `${date}T20:00:00+08:00`, timeZone: "Asia/Kuala_Lumpur" },
      end: { dateTime: `${date}T21:00:00+08:00`, timeZone: "Asia/Kuala_Lumpur" },
      guestsCanSeeOtherGuests: false,
      guestsCanInviteOthers: false,
      extendedProperties: { private: { tscClassDate: date } },
      conferenceData: { createRequest: { requestId: `tsc-${date}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    }),
  });
  return { id: ev.id as string, meet: meetFrom(ev), confStatus: ev.conferenceData?.createRequest?.status?.statusCode };
}

/** Find an existing event for a class date (prevents duplicates if our DB write failed). */
export async function calFindClassEvent(date: string) {
  const q = new URLSearchParams({ privateExtendedProperty: `tscClassDate=${date}`, singleEvents: "true" });
  const r = await google("calendar", `${CAL()}?${q}`);
  const ev = (r.items ?? []).find((e: any) => e.status !== "cancelled");
  return ev ? { id: ev.id as string, meet: meetFrom(ev) } : null;
}

export async function calGetEvent(id: string) {
  return google("calendar", `${CAL()}/${encodeURIComponent(id)}`);
}

/**
 * Add one attendee. Uses the event's ETag (If-Match) so two students being added
 * to the same class at the same moment can never overwrite each other.
 */
export async function calAddAttendee(id: string, email: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const ev = await calGetEvent(id);
    const attendees: { email: string }[] = ev.attendees ?? [];
    if (attendees.some((a) => a.email?.toLowerCase() === email.toLowerCase())) return "exists";
    try {
      await google("calendar", `${CAL()}/${encodeURIComponent(id)}?sendUpdates=all&conferenceDataVersion=1`, {
        method: "PATCH",
        headers: ev.etag ? { "If-Match": ev.etag } : {},
        body: JSON.stringify({ attendees: [...attendees, { email }] }),
      });
      return "added";
    } catch (e: any) {
      if (e?.status !== 412) throw e; // 412 = someone else changed the event; re-read and retry
    }
  }
  throw new Error("Calendar event kept changing; will retry");
}

export async function calRemoveAttendee(id: string, email: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const ev = await calGetEvent(id);
    const before: { email: string }[] = ev.attendees ?? [];
    const attendees = before.filter((a) => a.email?.toLowerCase() !== email.toLowerCase());
    if (attendees.length === before.length) return "absent";
    try {
      await google("calendar", `${CAL()}/${encodeURIComponent(id)}?sendUpdates=all`, {
        method: "PATCH",
        headers: ev.etag ? { "If-Match": ev.etag } : {},
        body: JSON.stringify({ attendees }),
      });
      return "removed";
    } catch (e: any) {
      if (e?.status !== 412) throw e;
    }
  }
  throw new Error("Calendar event kept changing; will retry");
}

export function meetFrom(ev: any): string | null {
  return ev?.hangoutLink ?? ev?.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri ?? null;
}

// ---------------- Gmail ----------------
const b64 = (s: string) => btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(""));
const hdr = (v: string) => (/^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`);

export async function gmailSend(to: string, subject: string, html: string) {
  if (/[\r\n]/.test(to)) throw new Error("Invalid recipient");
  const from = process.env["EMAIL_FROM"]; // optional, e.g. Teacher Sha <teachersha557@gmail.com>
  const raw = [
    ...(from ? [`From: ${hdr(from)}`] : []),
    `To: ${to}`,
    `Subject: ${hdr(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(html).replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");
  const enc = b64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return google("gmail", "/gmail/v1/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: enc }),
  });
}

// ---------------- WhatsApp (Meta Cloud API or Lovable gateway) ----------------
const waDirect = () => has("WHATSAPP_ACCESS_TOKEN") && has("WHATSAPP_PHONE_NUMBER_ID");
export const whatsappConfigured = () => waDirect() || (has("LOVABLE_API_KEY") && has("WHATSAPP_API_KEY"));
/** Sends only happen after Teacher Sha switches WHATSAPP_LIVE=true (after templates are approved and tested). */
export const whatsappLive = () => whatsappConfigured() && (process.env["WHATSAPP_LIVE"] ?? "").toLowerCase() === "true";

export const TEMPLATE_CLASS = () => process.env["WHATSAPP_TEMPLATE_CLASS"] || "class_reminder";
export const TEMPLATE_RENEWAL = () => process.env["WHATSAPP_TEMPLATE_RENEWAL"] || "renewal_reminder";

export async function waSendTemplate(toE164: string, name: string, params: string[], lang = process.env["WHATSAPP_TEMPLATE_LANG"] || "en") {
  const body = JSON.stringify({
    messaging_product: "whatsapp",
    to: toE164.replace(/^\+/, ""),
    type: "template",
    template: {
      name,
      language: { code: lang },
      components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
    },
  });
  let r: any;
  if (waDirect()) {
    const version = process.env["WHATSAPP_GRAPH_VERSION"] || "v23.0";
    const res = await fetch(`https://graph.facebook.com/${version}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env("WHATSAPP_ACCESS_TOKEN")}`, "Content-Type": "application/json" },
      body,
    });
    r = await readJson(res, "WhatsApp");
  } else {
    r = await gw("whatsapp", "WHATSAPP_API_KEY", "/messages", { method: "POST", body });
  }
  const id = r?.messages?.[0]?.id as string | undefined;
  if (!id) throw new Error("WhatsApp did not return a message id");
  return id;
}

/** Verifies Meta's X-Hub-Signature-256 header for WhatsApp webhooks. */
export async function verifyMetaSignature(rawBody: string, header: string | null): Promise<boolean> {
  const secret = process.env["WHATSAPP_APP_SECRET"];
  if (!secret || !header?.startsWith("sha256=")) return false;
  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Which integrations are set up (shown on the admin dashboard; no secrets). */
export function integrationStatus() {
  return {
    database: has("SUPABASE_URL") && has("SUPABASE_SERVICE_ROLE_KEY"),
    bclVerify: bclCanVerify(),
    bclLinks: bclCanCreateLinks(),
    bclTestMode: bclTestMode(),
    bclFormUrl: bclFormUrl(),
    calendar: calendarConfigured(),
    gmail: gmailConfigured(),
    googleMode: googleDirect() ? "direct" : calendarConfigured() ? "lovable" : "none",
    whatsapp: whatsappConfigured(),
    whatsappLive: whatsappLive(),
    whatsappWebhook: has("WHATSAPP_APP_SECRET") && has("WHATSAPP_VERIFY_TOKEN"),
    cron: has("CRON_SECRET") || has("LOVABLE_CRON_SECRET"),
  };
}
