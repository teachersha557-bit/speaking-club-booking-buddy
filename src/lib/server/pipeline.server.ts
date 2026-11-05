// Booking engine: booking creation, payment verification, allocation,
// calendar, email, WhatsApp. Every step is idempotent so cron retries,
// duplicate webhooks and admin retries are safe.
import {
  bclCanCreateLinks, bclCanVerify, bclCreatePaymentLink, bclFormUrl, bclGetTransaction,
  calAddAttendee, calCreateClassEvent, calFindClassEvent, calGetEvent, calRemoveAttendee,
  calendarConfigured, gmailConfigured, gmailSend, meetFrom, TEMPLATE_CLASS, TEMPLATE_RENEWAL,
  waSendTemplate, whatsappLive,
} from "./integrations.server";
import {
  PRICE_MYR, addDays, fmtEn, fmtMs, isValidStart, mytParts, packageDates, renewalEligibility, toCompact,
} from "../schedule";
import { REF_RE, extractReferences, generateReference } from "../booking-rules";

export const SITE_URL = (process.env["PUBLIC_SITE_URL"] || "https://teachershaspeaking.netlify.app").replace(/\/+$/, "");
/** Where the renewal reminder sends students (the existing Netlify booking section). */
export const RENEWAL_URL = process.env["PUBLIC_BOOKING_URL"] || `${SITE_URL}/#daftar`;

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 1000);
const nowIso = () => new Date().toISOString();
const timeLeft = (deadline: number) => Date.now() < deadline;

export function bookingPageUrl(reference: string, start: string) {
  return `${SITE_URL}/booking/${reference}?s=${toCompact(start)}`;
}

// ---------------------------------------------------------------------------
// 1. Create a booking (called by the Netlify site)
// ---------------------------------------------------------------------------
export interface NewBooking {
  name: string;
  email: string;
  whatsapp: string; // already E.164
  whatsapp_consent: boolean;
  start: string; // YYYY-MM-DD
  reference?: string | undefined;
}

export type CreateResult =
  | { ok: true; reference: string; start_date: string; dates: string[]; hold_expires_at: string | null; payment_url: string; payment_mode: string; booking_url: string; existing: boolean }
  | { ok: false; error: "INVALID_DATE" | "FULL" | "ALREADY_BOOKED" | "RATE_LIMIT"; full_dates?: string[]; reference?: string; status?: string };

export async function createBooking(input: NewBooking, now = new Date()): Promise<CreateResult> {
  if (!isValidStart(input.start, now)) return { ok: false, error: "INVALID_DATE" };
  const sb = await db();
  const email = input.email.trim().toLowerCase();

  // Simple abuse guard: max 6 booking attempts per email per hour.
  const { data: st } = await sb.from("students").select("id").eq("email", email).maybeSingle();
  if (st) {
    const { count } = await sb.from("bookings").select("id", { count: "exact", head: true })
      .eq("student_id", st.id).gte("created_at", new Date(now.getTime() - 3600e3).toISOString());
    if ((count ?? 0) >= 6) return { ok: false, error: "RATE_LIMIT" };
  }

  let reference = input.reference && REF_RE.test(input.reference) ? input.reference : generateReference();
  let res: any = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await sb.rpc("create_booking", {
      _ref: reference, _name: input.name.trim(), _email: email, _whatsapp: input.whatsapp,
      _consent: input.whatsapp_consent, _start: input.start,
    });
    if (!error) { res = data; break; }
    if ((error as any).code === "23505") { reference = generateReference(); continue; } // reference taken
    throw error;
  }
  if (!res) throw new Error("Could not allocate a booking reference");
  if (!res.ok) return { ok: false, error: res.error, full_dates: res.full_dates, reference: res.reference, status: res.status };

  const ref: string = res.reference ?? reference;
  const { data: b, error: bErr } = await sb.from("bookings").select("*").eq("id", res.booking_id).single();
  if (bErr) throw bErr;

  let paymentUrl: string | null = b.payment_link;
  let mode: string = b.payment_mode ?? "link";
  if (!paymentUrl) {
    mode = "form";
    paymentUrl = bclFormUrl();
    if (bclCanCreateLinks()) {
      try {
        paymentUrl = await bclCreatePaymentLink({ reference: ref, name: input.name, email, phone: input.whatsapp, amount: PRICE_MYR });
        mode = "link";
      } catch (e) {
        console.error("BCL payment link failed; falling back to the BCL form", errMsg(e));
        await sb.from("webhook_logs").insert({ source: "bcl", event_type: "payment_link_error", booking_reference: ref, status: "error", error: errMsg(e) });
      }
    }
    await sb.from("bookings").update({ payment_link: paymentUrl, payment_mode: mode }).eq("id", b.id);
  }

  return {
    ok: true, reference: ref, start_date: b.start_date, dates: packageDates(b.start_date),
    hold_expires_at: b.hold_expires_at, payment_url: paymentUrl, payment_mode: mode,
    booking_url: bookingPageUrl(ref, b.start_date), existing: !!res.existing,
  };
}

/** Public, PII-free booking status for the Netlify booking page. */
export async function getPublicBooking(reference: string) {
  const sb = await db();
  const { data: found } = await sb.from("bookings").select("*").eq("reference", reference).maybeSingle();
  if (!found) return null;
  let b = found;

  // Opportunistic payment check (throttled to once per 30 s per booking).
  const unpaid = (b.status === "held" || b.status === "expired") && b.payment_status !== "paid";
  const stale = !b.last_checked_at || Date.now() - Date.parse(b.last_checked_at) > 30_000;
  if (unpaid && stale && b.payment_mode === "link" && bclCanVerify()) {
    try {
      await verifyPayment({ reference, source: "status_check", deadline: Date.now() + 6000 });
      const { data: fresh } = await sb.from("bookings").select("*").eq("reference", reference).maybeSingle();
      if (fresh) b = fresh;
    } catch (e) {
      console.error("status check verify failed", errMsg(e));
    }
  }

  const holdActive = b.status === "held" && !!b.hold_expires_at && Date.parse(b.hold_expires_at) > Date.now();
  const status = b.status === "held" && !holdActive ? "expired" : b.status;
  return {
    reference: b.reference,
    status, // held | confirmed | expired | needs_resolution | cancelled
    payment_status: b.payment_status,
    start_date: b.start_date,
    dates: packageDates(b.start_date),
    price_myr: Number(b.price),
    hold_expires_at: holdActive ? b.hold_expires_at : null,
    payment_url: holdActive ? b.payment_link : null,
    payment_mode: b.payment_mode,
    confirmed_at: b.confirmed_at,
  };
}

/** Seat availability for upcoming Tuesdays (public, no personal data). */
export async function getAvailability(now = new Date(), weeks = 12) {
  const { nextEligibleTuesday } = await import("../schedule");
  const sb = await db();
  const from = nextEligibleTuesday(now);
  const { data, error } = await sb.rpc("class_availability", { _from: from, _weeks: weeks });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ date: r.class_date, capacity: r.capacity, remaining: Math.max(0, r.capacity - r.taken) }));
}

// ---------------------------------------------------------------------------
// 2. Payment verification (BCL)
// ---------------------------------------------------------------------------
export interface VerifyOpts {
  reference: string;
  orderNumber?: string; // BCL order number; equals the reference for per-booking payment links
  source: string;
  /** Admin has checked the payer's identity manually (skips payer-email match only). */
  identityOverride?: boolean;
  deadline?: number;
}

/** Check BCL for a booking's payment. Returns the resulting booking status. */
export async function verifyPayment(o: VerifyOpts): Promise<string> {
  const sb = await db();
  const orderNumber = o.orderNumber ?? o.reference;
  const deadline = o.deadline ?? Date.now() + 8000;
  const { data: b, error: bookingError } = await sb.from("bookings").select("*, students(*)").eq("reference", o.reference).maybeSingle();
  if (bookingError) throw bookingError;
  if (!b) {
    await sb.from("webhook_logs").insert({ source: o.source, event_type: "verify", booking_reference: o.reference, order_number: orderNumber, status: "unmatched", error: "No booking with this reference" });
    return "unmatched";
  }
  await sb.from("bookings").update({ last_checked_at: nowIso() }).eq("id", b.id);
  if (!bclCanVerify()) {
    if (o.source === "admin") throw new Error("BCL API token is not configured");
    return b.status;
  }

  const t = await bclGetTransaction(orderNumber);
  if (!t.found) {
    if (o.source === "admin") throw new Error(`BCL has no transaction with order number ${orderNumber}`);
    return b.status;
  }

  // Is this BCL order already linked to a different booking?
  const { data: prior } = await sb.from("payments").select("*").eq("order_number", orderNumber).maybeSingle();
  if (prior?.booking_reference && prior.booking_reference !== o.reference) {
    await sb.from("webhook_logs").insert({ source: o.source, event_type: "verify", booking_reference: o.reference, order_number: orderNumber, status: "needs_resolution", error: `BCL order ${orderNumber} is already linked to ${prior.booking_reference}` });
    if (o.source === "admin") throw new Error(`BCL order ${orderNumber} is already linked to ${prior.booking_reference}`);
    return b.status;
  }
  const problems: string[] = [];
  if (t.orderNumber !== orderNumber) problems.push("order number mismatch");
  if (!t.isPaid || t.status !== 3) problems.push(`not paid (${t.statusDescription ?? t.status})`);
  if ((t.currency ?? "").toUpperCase() !== "MYR") problems.push(`currency ${t.currency}`);
  if (!Number.isFinite(t.subtotal) || Math.round(Number(t.subtotal) * 100) !== Math.round(Number(b.price) * 100)) problems.push(`amount ${t.subtotal}`);
  const student = (b as any).students;
  const emailOk = !!t.payerEmail && !!student?.email && t.payerEmail.toLowerCase() === student.email.toLowerCase();
  if (!emailOk && !o.identityOverride) problems.push("payer email differs from booking email");

  const { error: paymentError } = await sb.from("payments").upsert({
    order_number: orderNumber, booking_reference: o.reference, booking_id: b.id,
    amount: t.amount, subtotal: t.subtotal, currency: t.currency,
    status: t.statusDescription ?? String(t.status), is_paid: t.isPaid,
    verification_result: problems.length ? problems.join("; ") : o.identityOverride && !emailOk ? "verified (identity checked by admin)" : "verified",
    verified_at: nowIso(), audit: t.raw as any,
  }, { onConflict: "order_number" });
  if (paymentError) throw paymentError;

  if (!t.isPaid) {
    if (t.status === 2) await sb.from("bookings").update({ payment_status: "failed" }).eq("id", b.id).neq("status", "confirmed");
    return b.status;
  }

  // A second, different successful payment for an already-confirmed booking.
  if (b.status === "confirmed") {
    const { data: others } = await sb.from("payments").select("order_number").eq("booking_id", b.id).not("processed_at", "is", null).neq("order_number", orderNumber);
    if (others?.length) {
      await sb.from("payments").update({ resolution_status: "flagged", verification_result: "duplicate payment for a confirmed booking (refund?)" }).eq("order_number", orderNumber);
      return "confirmed";
    }
  }

  if (problems.length) {
    if (b.status !== "confirmed") {
      await sb.from("bookings").update({ status: "needs_resolution", payment_status: "paid", hold_expires_at: null, resolution_note: problems.join("; ") }).eq("id", b.id);
    }
    await sb.from("payments").update({ resolution_status: "flagged" }).eq("order_number", orderNumber);
    return b.status === "confirmed" ? "confirmed" : "needs_resolution";
  }

  // Claim processing so two concurrent calls don't double-process.
  await sb.from("payments").update({ processed_at: nowIso() }).eq("order_number", orderNumber).is("processed_at", null);
  const { data: result, error } = await sb.rpc("confirm_booking", { _bid: b.id });
  if (error) throw error;
  if (result === "needs_resolution") {
    await sb.from("payments").update({ resolution_status: "flagged" }).eq("order_number", orderNumber);
    return "needs_resolution";
  }
  await sb.from("payments").update({ resolution_status: "none" }).eq("order_number", orderNumber).eq("resolution_status", "flagged");
  // Cancel any pending renewal reminder for the student's previous package.
  await sb.from("notifications").update({ status: "cancelled", error: "renewed" })
    .eq("type", "renewal").eq("student_id", b.student_id).in("status", ["scheduled", "failed"]);
  try { await fulfil(b.id, deadline); } catch (e) { console.error("fulfil after confirm", errMsg(e)); }
  return "confirmed";
}

/** Back-compat wrapper used by older callers. */
export const verifyBookingPayment = (reference: string, source: string) => verifyPayment({ reference, source });

/**
 * BCL payment notification. The payload is only used to find WHICH booking to
 * check; the payment itself is always re-verified through the BCL API.
 */
export async function handleBclWebhook(rawBody: string, payload: Record<string, unknown>) {
  const sb = await db();
  const { createHash } = await import("node:crypto");
  const dedupe = createHash("sha256").update(rawBody).digest("hex");
  const refs = extractReferences(rawBody);
  const orderNumber = typeof payload["order_number"] === "string" ? (payload["order_number"] as string).slice(0, 100) : undefined;

  const { data: log, error } = await sb.from("webhook_logs").insert({
    source: "bcl", event_type: "payment_notification", order_number: orderNumber ?? null,
    booking_reference: refs[0] ?? null, status: "received", payload: payload as any, dedupe_key: dedupe,
  }).select("id").single();
  if (error) {
    if ((error as any).code !== "23505") throw error;
    const { data: prev } = await sb.from("webhook_logs").select("id, status").eq("dedupe_key", dedupe).single();
    if (prev?.status === "processed") return { status: "duplicate" };
    return processWebhook(prev!.id, refs, orderNumber);
  }
  return processWebhook(log.id, refs, orderNumber);
}

async function processWebhook(logId: string, refs: string[], orderNumber?: string) {
  const sb = await db();
  if (!refs.length) {
    await sb.from("webhook_logs").update({ status: "unmatched", error: "No booking reference found in notification" }).eq("id", logId);
    return { status: "unmatched" };
  }
  const results: Record<string, string> = {};
  try {
    for (const ref of refs.slice(0, 3)) {
      let st = "pending";
      if (orderNumber && orderNumber !== ref) {
        try { st = await verifyPayment({ reference: ref, orderNumber, source: "webhook", deadline: Date.now() + 6000 }); } catch (e) { st = `error: ${errMsg(e)}`; }
      }
      if (!["confirmed", "needs_resolution"].includes(st)) st = await verifyPayment({ reference: ref, source: "webhook", deadline: Date.now() + 6000 });
      results[ref] = st;
    }
    const final = Object.values(results).some((s) => s === "confirmed") ? "processed"
      : Object.values(results).some((s) => s === "needs_resolution") ? "needs_resolution"
      : Object.values(results).every((s) => s === "unmatched") ? "unmatched" : "pending_payment";
    await sb.from("webhook_logs").update({ status: final, error: final === "processed" ? null : JSON.stringify(results).slice(0, 1000) }).eq("id", logId);
    return { status: final };
  } catch (e) {
    await sb.from("webhook_logs").update({ status: "error", error: errMsg(e) }).eq("id", logId);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 3. Calendar + Meet
// ---------------------------------------------------------------------------
/** Ensure the class has one Calendar event + Meet link. Never duplicates. */
export async function ensureClassEvent(classId: string) {
  const sb = await db();
  const { data: c } = await sb.from("class_sessions").select("*").eq("id", classId).single();
  if (!c) throw new Error("class not found");
  if (c.calendar_event_id && c.meet_link) return c;
  if (!calendarConfigured()) throw new Error("Google Calendar is not connected");
  try {
    let id = c.calendar_event_id as string | null;
    let meet: string | null = null;
    if (!id) {
      // Claim creation so two bookings can't create two events for one Tuesday.
      const staleBefore = new Date(Date.now() - 2 * 60e3).toISOString();
      const { data: claim } = await sb.from("class_sessions").update({ event_status: "creating", event_claimed_at: nowIso() })
        .eq("id", classId).is("calendar_event_id", null)
        .or(`event_claimed_at.is.null,event_claimed_at.lt.${staleBefore}`).select("id");
      if (!claim?.length) throw new Error("Event is being created by another process; will retry");
      const existing = await calFindClassEvent(c.class_date);
      if (existing) ({ id, meet } = existing);
      else ({ id, meet } = await calCreateClassEvent(c.class_date));
      await sb.from("class_sessions").update({ calendar_event_id: id, event_status: meet ? "ready" : "meet_pending" }).eq("id", classId);
    }
    if (!meet && id) meet = meetFrom(await calGetEvent(id));
    if (!meet) throw new Error("Google has not confirmed the Meet link yet");
    const { data } = await sb.from("class_sessions").update({ meet_link: meet, event_status: "ready", event_error: null }).eq("id", classId).select("*").single();
    return data!;
  } catch (e) {
    const msg = errMsg(e);
    if (!msg.includes("another process")) {
      await sb.from("class_sessions").update({ event_status: "failed", event_error: msg, event_claimed_at: null }).eq("id", classId);
    }
    throw e;
  }
}

/** After confirmation: events, attendees, then one confirmation email. */
export async function fulfil(bookingId: string, deadline = Date.now() + 8000) {
  const sb = await db();
  const { data: b } = await sb.from("bookings").select("*, students(*), booking_classes(position, attendee_added, class_id, class_sessions(*))").eq("id", bookingId).single();
  if (!b || b.status !== "confirmed") return;
  const student = (b as any).students;
  const rows = ((b as any).booking_classes as any[]).sort((x, y) => x.position - y.position);
  let calOk = true;
  const errors: string[] = [];
  for (const r of rows) {
    if (!timeLeft(deadline)) { calOk = false; errors.push("time budget reached; will continue"); break; }
    try {
      const c = await ensureClassEvent(r.class_id);
      if (!r.attendee_added) {
        await calAddAttendee(c.calendar_event_id!, student.email);
        await sb.from("booking_classes").update({ attendee_added: true }).eq("booking_id", bookingId).eq("class_id", r.class_id);
      }
    } catch (e) {
      calOk = false;
      errors.push(`${r.class_sessions?.class_date}: ${errMsg(e)}`);
    }
  }
  await sb.from("bookings").update(calOk ? { calendar_status: "done", calendar_error: null } : { calendar_status: "failed", calendar_error: errors.join(" | ").slice(0, 1000) }).eq("id", bookingId);

  // Email only once all four Meet links exist.
  if (!timeLeft(deadline)) return;
  const { data: classes } = await sb.from("booking_classes").select("position, class_sessions(class_date, meet_link)").eq("booking_id", bookingId).order("position");
  const links = (classes ?? []).map((x: any) => x.class_sessions);
  if (links.length !== 4 || links.some((l: any) => !l.meet_link)) return;
  await sendConfirmationEmail(bookingId, student, b.reference, links, false);
}

// ---------------------------------------------------------------------------
// 4. Confirmation email
// ---------------------------------------------------------------------------
export async function sendConfirmationEmail(
  bookingId: string, student: { name: string; email: string }, reference: string,
  links: { class_date: string; meet_link: string }[], force: boolean,
): Promise<string> {
  const sb = await db();
  if (!gmailConfigured()) return "not_configured";
  const { data: ex } = await sb.from("email_logs").select("*").eq("booking_id", bookingId).eq("email_type", "confirmation").maybeSingle();
  if (ex?.status === "sent" && !force) return "already_sent";
  if (!ex) {
    const { error } = await sb.from("email_logs").insert({ booking_id: bookingId, recipient: student.email, email_type: "confirmation", status: "sending", attempts: 1, attempted_at: nowIso() });
    if (error) return "in_progress"; // another process claimed it
  } else {
    const recent = ex.attempted_at && Date.now() - Date.parse(ex.attempted_at) < 5 * 60e3;
    if (ex.status === "sending" && recent) return "in_progress";
    if (!force && (ex.attempts ?? 0) >= 5) return "gave_up";
    const { data: claimed } = await sb.from("email_logs")
      .update({ status: "sending", error: null, recipient: student.email, attempts: (ex.attempts ?? 0) + 1, attempted_at: nowIso() })
      .eq("id", ex.id).eq("status", ex.status).eq("attempts", ex.attempts ?? 0).select("id");
    if (!claimed?.length) return "in_progress";
  }
  try {
    await gmailSend(student.email, "Your Teacher Sha Speaking Club Booking Is Confirmed!", confirmationHtml(student.name, reference, links));
    await sb.from("email_logs").update({ status: "sent", sent_at: nowIso() }).eq("booking_id", bookingId).eq("email_type", "confirmation");
    return "sent";
  } catch (e) {
    await sb.from("email_logs").update({ status: "failed", error: errMsg(e) }).eq("booking_id", bookingId).eq("email_type", "confirmation");
    return "failed";
  }
}

/** Admin: resend the confirmation email (always to the student on the booking). */
export async function resendConfirmation(bookingId: string) {
  const sb = await db();
  const { data: b } = await sb.from("bookings").select("id, reference, status, students(name, email), booking_classes(position, class_sessions(class_date, meet_link))").eq("id", bookingId).single();
  if (!b || b.status !== "confirmed") throw new Error("Only confirmed bookings can be emailed");
  const links = ((b as any).booking_classes as any[]).sort((x, y) => x.position - y.position).map((x) => x.class_sessions);
  if (links.length !== 4 || links.some((l: any) => !l.meet_link)) throw new Error("All four Meet links must exist first (retry calendar)");
  if (!gmailConfigured()) throw new Error("Gmail is not connected");
  const r = await sendConfirmationEmail(b.id, (b as any).students, b.reference, links, true);
  if (r !== "sent") throw new Error(`Email ${r}`);
  return r;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function confirmationHtml(name: string, reference: string, links: { class_date: string; meet_link: string }[]) {
  const items = links.map((l, i) =>
    `<li style="margin:0 0 12px"><b>Class ${i + 1}: ${fmtEn(l.class_date)}</b> (${fmtMs(l.class_date)})<br>Google Meet: <a href="${esc(l.meet_link)}">${esc(l.meet_link)}</a></li>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:Arial,sans-serif;color:#222">
<div style="max-width:560px;margin:0 auto;padding:24px">
<h1 style="font-size:22px">Your Teacher Sha Speaking Club Booking Is Confirmed! 🍓</h1>
<p>Hi ${esc(name)},</p>
<p>Your RM49 payment was received and verified successfully. Thank you!</p>
<p><b>Booking Reference:</b> ${esc(reference)}</p>
<p><b>Your four classes:</b></p><ol style="padding-left:20px">${items}</ol>
<p><b>Class time:</b> Every Tuesday, 8 PM–9 PM (Malaysia time), on Google Meet.</p>
<p style="background:#fff6d6;padding:12px;border-radius:8px"><b>Each Tuesday has its own unique Google Meet link.</b> Please use the correct link for each class. You will also receive Google Calendar invitations.</p>
<p><b>Booking policies:</b></p><ul>
<li>RM49 is a one-time payment covering 4 consecutive Tuesday classes. There is no automatic subscription.</li>
<li>All four dates are reserved together.</li>
<li>Each Tuesday has a different Google Meet link.</li>
<li>Missing a class means forfeiting that class. There is no carry-forward, replacement class or refund for student absence.</li>
<li>A new RM49 payment is required for another 4-class package.</li>
<li>Maximum 10 students per Tuesday.</li></ul>
<p>See you in class!<br>Teacher Sha</p></div></body></html>`;
}

// ---------------------------------------------------------------------------
// 5. WhatsApp
// ---------------------------------------------------------------------------
/** Tuesday 2 PM: one reminder per confirmed student for today's class. */
export async function runClassReminders(now = new Date()) {
  if (!whatsappLive()) return { skipped: "WhatsApp is not live (set WHATSAPP_LIVE=true after testing)" };
  const sb = await db();
  const p = mytParts(now);
  if (p.dow !== 2 || p.hour < 14 || p.hour >= 20) return { skipped: "outside Tuesday 2–8 PM MYT" };
  const { data: cls } = await sb.from("class_sessions").select("*").eq("class_date", p.date).maybeSingle();
  if (!cls) return { sent: 0 };
  const { data: rows } = await sb.from("booking_classes")
    .select("booking_id, bookings!inner(id, status, payment_status, student_id, students!inner(*))")
    .eq("class_id", cls.id).eq("bookings.status", "confirmed").eq("bookings.payment_status", "paid");
  let sent = 0;
  let meetLink: string | null = cls.meet_link;
  for (const r of rows ?? []) {
    const b: any = (r as any).bookings, s = b.students;
    if (!s.whatsapp_consent || !s.whatsapp || !s.active) continue;
    const ok = await sendOnce({
      type: "class_reminder", booking_id: b.id, student_id: s.id, class_date: p.date, whatsapp_number: s.whatsapp,
      scheduled_for: `${p.date}T14:00:00+08:00`,
    }, async () => {
      if (!meetLink) meetLink = (await ensureClassEvent(cls.id)).meet_link;
      if (!meetLink) throw new Error("Meet link missing for this class");
      return waSendTemplate(s.whatsapp, TEMPLATE_CLASS(), [s.name, fmtEn(p.date), meetLink]);
    });
    if (ok) sent++;
  }
  return { sent };
}

/** Wednesday 10 AM after final class: one reminder for eligible continuing students. */
export async function runRenewalReminders(now = new Date()) {
  if (!whatsappLive()) return { skipped: "WhatsApp is not live (set WHATSAPP_LIVE=true after testing)" };
  const sb = await db();
  const p = mytParts(now);
  if (p.dow !== 3 || p.hour !== 10) return { skipped: "outside Wednesday 10 AM MYT" };
  // The final class was yesterday (start + 21); today is start + 22.
  const { data: pkgs } = await sb.from("bookings").select("id, start_date, status, payment_status, student_id, students(*)")
    .eq("status", "confirmed").eq("payment_status", "paid").eq("start_date", addDays(p.date, -22));
  let sent = 0;
  for (const pkg of pkgs ?? []) {
    const s: any = (pkg as any).students;
    const { data: history } = await sb.from("bookings").select("start_date, status, payment_status").eq("student_id", pkg.student_id)
      .in("status", ["confirmed", "needs_resolution"]);
    const elig = renewalEligibility(pkg as any, (history ?? []) as any, now, s);
    if (!elig.eligible) {
      if (elig.reason === "renewed") await sb.from("notifications").update({ status: "cancelled", error: "renewed" }).eq("type", "renewal").eq("booking_id", pkg.id).in("status", ["scheduled", "failed"]);
      continue;
    }
    const ok = await sendOnce({
      type: "renewal", booking_id: pkg.id, student_id: s.id, class_date: addDays(pkg.start_date, 21), whatsapp_number: s.whatsapp,
      scheduled_for: `${p.date}T10:00:00+08:00`,
    }, () => waSendTemplate(s.whatsapp, TEMPLATE_RENEWAL(), [s.name, RENEWAL_URL]));
    if (ok) sent++;
  }
  return { sent };
}

const DONE = ["sent", "delivered", "read", "cancelled", "sending"];

/** Idempotent send: (type, booking, class_date) unique row, retried up to 3 times when failed. */
export async function sendOnce(
  row: { type: string; booking_id: string; student_id: string; class_date: string; whatsapp_number: string; scheduled_for: string },
  send: () => Promise<string | undefined>,
): Promise<boolean> {
  const sb = await db();
  const { data: ex } = await sb.from("notifications").select("*").eq("type", row.type).eq("booking_id", row.booking_id).eq("class_date", row.class_date).maybeSingle();
  if (ex && (DONE.includes(ex.status) || ex.attempts >= 3)) return false;
  if (!ex) {
    const { error } = await sb.from("notifications").insert({ ...row, status: "sending", attempts: 1 });
    if (error) return false; // another run claimed it
  } else {
    const { data: claimed } = await sb.from("notifications").update({ status: "sending", attempts: ex.attempts + 1 }).eq("id", ex.id).eq("status", ex.status).eq("attempts", ex.attempts).select("id");
    if (!claimed?.length) return false;
  }
  try {
    const id = await send();
    await sb.from("notifications").update({ status: "sent", sent_at: nowIso(), provider_message_id: id ?? null, error: null })
      .eq("type", row.type).eq("booking_id", row.booking_id).eq("class_date", row.class_date);
    return true;
  } catch (e) {
    await sb.from("notifications").update({ status: "failed", error: errMsg(e) })
      .eq("type", row.type).eq("booking_id", row.booking_id).eq("class_date", row.class_date);
    return false;
  }
}

/** Admin: retry one failed WhatsApp message (same rules; never a duplicate). */
export async function retryNotification(id: string, now = new Date()) {
  if (!whatsappLive()) throw new Error("WhatsApp is not live");
  const sb = await db();
  const { data: n } = await sb.from("notifications").select("*, students(*), bookings(id, status, payment_status, start_date, student_id)").eq("id", id).single();
  if (!n) throw new Error("Notification not found");
  if (n.status !== "failed") throw new Error(`Only failed messages can be retried (status: ${n.status})`);
  const s: any = (n as any).students, b: any = (n as any).bookings;
  if (!s?.whatsapp || !s.whatsapp_consent || !s.active) throw new Error("Student has no WhatsApp consent / is inactive");
  if (!b || b.status !== "confirmed") throw new Error("Booking is no longer confirmed");
  let send: () => Promise<string>;
  if (n.type === "class_reminder") {
    const p = mytParts(now);
    if (n.class_date !== p.date || p.hour >= 20) throw new Error("This class reminder is no longer relevant");
    const { data: cls } = await sb.from("class_sessions").select("id, meet_link").eq("class_date", n.class_date!).single();
    const link = cls?.meet_link ?? (cls ? (await ensureClassEvent(cls.id)).meet_link : null);
    if (!link) throw new Error("Meet link missing");
    send = () => waSendTemplate(s.whatsapp, TEMPLATE_CLASS(), [s.name, fmtEn(n.class_date!), link]);
  } else if (n.type === "renewal") {
    const { data: later } = await sb.from("bookings").select("id").eq("student_id", b.student_id).eq("payment_status", "paid").gt("start_date", b.start_date).limit(1);
    if (later?.length) throw new Error("Student has already renewed");
    send = () => waSendTemplate(s.whatsapp, TEMPLATE_RENEWAL(), [s.name, RENEWAL_URL]);
  } else throw new Error("Unknown notification type");
  await sb.from("notifications").update({ attempts: 0 }).eq("id", id).eq("status", "failed");
  const ok = await sendOnce({ type: n.type, booking_id: n.booking_id!, student_id: n.student_id!, class_date: n.class_date!, whatsapp_number: s.whatsapp, scheduled_for: n.scheduled_for ?? nowIso() }, send);
  if (!ok) {
    const { data: after } = await sb.from("notifications").select("error").eq("id", id).single();
    throw new Error(after?.error ?? "Retry failed");
  }
  return "sent";
}

/** Meta delivery status + STOP opt-outs. */
export async function handleWhatsappWebhook(rawBody: string, payload: any) {
  const sb = await db();
  const { createHash } = await import("node:crypto");
  const deliveryId = createHash("sha256").update(rawBody).digest("hex");
  const { error } = await sb.from("whatsapp_webhook_events").insert({ delivery_id: deliveryId, event: "meta", payload });
  if (error) return { status: "duplicate" };
  const rank: Record<string, number> = { sending: 0, failed: 1, sent: 2, delivered: 3, read: 4 };
  try {
    for (const entry of payload?.entry ?? []) {
      for (const ch of entry?.changes ?? []) {
        const v = ch?.value ?? {};
        for (const st of v.statuses ?? []) {
          if (!st?.id || !st?.status) continue;
          const { data: n } = await sb.from("notifications").select("id, status").eq("provider_message_id", st.id).maybeSingle();
          if (!n) continue;
          if (st.status === "failed") {
            await sb.from("notifications").update({ status: "failed", error: JSON.stringify(st.errors ?? "delivery failed").slice(0, 1000) }).eq("id", n.id);
          } else if ((rank[st.status] ?? -1) > (rank[n.status] ?? -1)) {
            await sb.from("notifications").update({ status: st.status }).eq("id", n.id);
          }
        }
        for (const m of v.messages ?? []) {
          const text = String(m?.text?.body ?? m?.button?.text ?? "").trim();
          if (/^(stop|berhenti|unsubscribe)$/i.test(text) && m?.from) {
            await sb.from("students").update({ whatsapp_consent: false }).eq("whatsapp", `+${String(m.from).replace(/\D/g, "")}`);
          }
        }
      }
    }
    await sb.from("whatsapp_webhook_events").update({ processed_at: nowIso() }).eq("delivery_id", deliveryId);
  } catch (e) {
    await sb.from("whatsapp_webhook_events").update({ processing_error: errMsg(e), attempts: 1 }).eq("delivery_id", deliveryId);
    throw e;
  }
  return { status: "processed" };
}

// ---------------------------------------------------------------------------
// 6. Admin operations
// ---------------------------------------------------------------------------
export async function cancelBooking(bookingId: string, reason: string) {
  const sb = await db();
  const { data: b } = await sb.from("bookings").select("*, students(email), booking_classes(class_id, attendee_added, class_sessions(calendar_event_id))").eq("id", bookingId).single();
  if (!b) throw new Error("Booking not found");
  if (b.status === "cancelled") return "already_cancelled";
  const { error } = await sb.from("bookings").update({ status: "cancelled", cancelled_at: nowIso(), hold_expires_at: null, resolution_note: reason || "Cancelled by admin" }).eq("id", bookingId);
  if (error) throw error;
  await sb.from("notifications").update({ status: "cancelled", error: "booking cancelled" }).eq("booking_id", bookingId).in("status", ["scheduled", "failed"]);
  const problems: string[] = [];
  for (const r of ((b as any).booking_classes ?? []) as any[]) {
    const ev = r.class_sessions?.calendar_event_id;
    if (!r.attendee_added || !ev) continue;
    try {
      await calRemoveAttendee(ev, (b as any).students.email);
      await sb.from("booking_classes").update({ attendee_added: false }).eq("booking_id", bookingId).eq("class_id", r.class_id);
    } catch (e) { problems.push(errMsg(e)); }
  }
  if (problems.length) await sb.from("bookings").update({ calendar_error: `Remove from calendar failed: ${problems.join(" | ")}`.slice(0, 1000) }).eq("id", bookingId);
  return problems.length ? "cancelled_calendar_pending" : "cancelled";
}

export async function setPaymentFlag(orderNumber: string, flag: "flagged" | "resolved" | "none", note?: string) {
  const sb = await db();
  const patch: { resolution_status: string; verification_result?: string } = { resolution_status: flag };
  if (note) patch.verification_result = note.slice(0, 500);
  const { error } = await sb.from("payments").update(patch).eq("order_number", orderNumber);
  if (error) throw error;
}

export async function setWebhookResolved(id: string) {
  const sb = await db();
  await sb.from("webhook_logs").update({ status: "resolved" }).eq("id", id);
}

// ---------------------------------------------------------------------------
// 7. Scheduled housekeeping (every 10 minutes)
// ---------------------------------------------------------------------------
export async function runTick(budgetMs = 20_000) {
  const deadline = Date.now() + budgetMs;
  const sb = await db();
  const { data: expired, error: expiryError } = await sb.rpc("expire_holds");
  if (expiryError) throw expiryError;

  // Poll BCL for per-booking payment links (order number = reference).
  let checked = 0;
  if (bclCanVerify()) {
    const since = new Date(Date.now() - 3 * 864e5).toISOString();
    const { data: pending, error: pendingError } = await sb.from("bookings").select("reference").in("status", ["held", "expired"])
      .eq("payment_mode", "link").neq("payment_status", "paid").gte("created_at", since)
      .order("last_checked_at", { ascending: true, nullsFirst: true }).limit(40);
    if (pendingError) throw pendingError;
    for (const b of pending ?? []) {
      if (!timeLeft(deadline - 4000)) break;
      try { await verifyPayment({ reference: b.reference, source: "poll", deadline }); checked++; } catch (e) { console.error("poll", b.reference, errMsg(e)); }
    }
  }

  // Retry calendar work and missing confirmation emails.
  let retried = 0;
  const { data: retry } = await sb.from("bookings").select("id").eq("status", "confirmed").neq("calendar_status", "done").order("confirmed_at").limit(20);
  const since = new Date(Date.now() - 21 * 864e5).toISOString();
  const { data: recent } = await sb.from("bookings").select("id, email_logs(status, attempts)").eq("status", "confirmed").gte("confirmed_at", since).limit(200);
  const needEmail = (recent ?? []).filter((b: any) => !(b.email_logs ?? []).some((e: any) => e.status === "sent" || (e.attempts ?? 0) >= 5)).map((b: any) => b.id);
  const ids = [...new Set([...(retry ?? []).map((r) => r.id), ...needEmail])];
  for (const id of ids) {
    if (!timeLeft(deadline - 3000)) break;
    try { await fulfil(id, deadline); retried++; } catch (e) { console.error("fulfil", errMsg(e)); }
  }
  return { expired, checked, retried };
}

export { toCompact };
