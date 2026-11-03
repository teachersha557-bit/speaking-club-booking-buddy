// Server-only clients for BCL, Google Calendar, Gmail and WhatsApp.
// Never import from browser code.

const GW = "https://connector-gateway.lovable.dev";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
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
  const text = await res.text();
  if (!res.ok) throw new Error(`${connector} ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

// ---------------- BCL ----------------
const BCL = "https://api.bcl.my/v1";
const UA = "TeacherShaSpeakingClub/1.0";

export function bclConfigured() {
  return !!process.env.BCL_API_TOKEN && !!process.env.BCL_PORTAL_KEY;
}
export function bclTestMode() {
  return (process.env.BCL_TEST_MODE ?? "true").toLowerCase() !== "false";
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
  const text = await res.text();
  if (!res.ok) throw new Error(`BCL payment link ${res.status}: ${text.slice(0, 400)}`);
  const link = JSON.parse(text)?.data?.payment_link;
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
  const text = await res.text();
  if (!res.ok) throw new Error(`BCL lookup ${res.status}: ${text.slice(0, 300)}`);
  const j = JSON.parse(text)?.data ?? {};
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
const CAL = "/calendar/v3/calendars/primary/events";

export async function calCreateClassEvent(date: string) {
  const ev = await gw("google_calendar", "GOOGLE_CALENDAR_API_KEY", `${CAL}?conferenceDataVersion=1&sendUpdates=none`, {
    method: "POST",
    body: JSON.stringify({
      summary: "Teacher Sha Speaking Club",
      description: "Kelas English speaking, 8:00–9:00 PM waktu Malaysia.",
      start: { dateTime: `${date}T20:00:00+08:00`, timeZone: "Asia/Kuala_Lumpur" },
      end: { dateTime: `${date}T21:00:00+08:00`, timeZone: "Asia/Kuala_Lumpur" },
      guestsCanSeeOtherGuests: false,
      extendedProperties: { private: { tscClassDate: date } },
      conferenceData: { createRequest: { requestId: `tsc-${date}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    }),
  });
  return { id: ev.id as string, meet: meetFrom(ev), confStatus: ev.conferenceData?.createRequest?.status?.statusCode };
}

/** Find an existing event for a class date (prevents duplicates if our DB write failed). */
export async function calFindClassEvent(date: string) {
  const q = new URLSearchParams({ privateExtendedProperty: `tscClassDate=${date}`, singleEvents: "true" });
  const r = await gw("google_calendar", "GOOGLE_CALENDAR_API_KEY", `${CAL}?${q}`);
  const ev = (r.items ?? []).find((e: any) => e.status !== "cancelled");
  return ev ? { id: ev.id as string, meet: meetFrom(ev) } : null;
}

export async function calGetEvent(id: string) {
  return gw("google_calendar", "GOOGLE_CALENDAR_API_KEY", `${CAL}/${encodeURIComponent(id)}`);
}

export async function calAddAttendee(id: string, email: string) {
  const ev = await calGetEvent(id);
  const attendees: { email: string }[] = ev.attendees ?? [];
  if (attendees.some((a) => a.email?.toLowerCase() === email.toLowerCase())) return "exists";
  await gw("google_calendar", "GOOGLE_CALENDAR_API_KEY", `${CAL}/${encodeURIComponent(id)}?sendUpdates=all&conferenceDataVersion=1`, {
    method: "PATCH",
    body: JSON.stringify({ attendees: [...attendees, { email }] }),
  });
  return "added";
}

export async function calRemoveAttendee(id: string, email: string) {
  const ev = await calGetEvent(id);
  const attendees = (ev.attendees ?? []).filter((a: any) => a.email?.toLowerCase() !== email.toLowerCase());
  await gw("google_calendar", "GOOGLE_CALENDAR_API_KEY", `${CAL}/${encodeURIComponent(id)}?sendUpdates=all`, {
    method: "PATCH",
    body: JSON.stringify({ attendees }),
  });
}

export function meetFrom(ev: any): string | null {
  return ev?.hangoutLink ?? ev?.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri ?? null;
}

// ---------------- Gmail ----------------
const b64 = (s: string) => btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(""));
const hdr = (v: string) => (/^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`);

export async function gmailSend(to: string, subject: string, html: string) {
  const raw = [
    `To: ${to}`,
    `Subject: ${hdr(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(html),
  ].join("\r\n");
  const enc = b64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return gw("google_mail", "GOOGLE_MAIL_API_KEY", "/gmail/v1/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: enc }),
  });
}

// ---------------- WhatsApp ----------------
export async function waSendTemplate(toE164: string, name: string, params: string[], lang = "en") {
  const r = await gw("whatsapp", "WHATSAPP_API_KEY", "/messages", {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toE164.replace(/^\+/, ""),
      type: "template",
      template: {
        name,
        language: { code: lang },
        components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
      },
    }),
  });
  return r?.messages?.[0]?.id as string | undefined;
}
