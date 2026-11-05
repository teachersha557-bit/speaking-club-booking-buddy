// Booking engine: payment verification, allocation, calendar, email, WhatsApp.
// Every step is idempotent so cron retries and duplicate webhooks are safe.
import {
  bclConfigured, bclGetTransaction, calAddAttendee, calCreateClassEvent, calFindClassEvent,
  calGetEvent, gmailSend, meetFrom, waSendTemplate,
} from "./integrations.server";
import { PRICE_MYR, addDays, fmtEn, fmtMs, mytParts, renewalEligibility, toCompact } from "../schedule";

export const SITE_URL = "https://teachershaspeaking.netlify.app";
export const TEMPLATE_CLASS = "class_reminder";
export const TEMPLATE_RENEWAL = "renewal_reminder";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 1000);

/** Check BCL for a booking's payment. Returns the new booking status. */
export async function verifyBookingPayment(reference: string, source: string): Promise<string> {
  const sb = await db();
  const { data: b } = await sb.from("bookings").select("*, students(*)").eq("reference", reference).maybeSingle();
  if (!b) {
    await sb.from("webhook_logs").insert({ source, event_type: "verify", booking_reference: reference, order_number: reference, status: "unmatched", error: "No booking with this reference" });
    return "unmatched";
  }
  if (b.status === "confirmed") { await fulfil(b.id); return "confirmed"; }
  if (!bclConfigured()) return b.status;

  const t = await bclGetTransaction(reference);
  if (!t.found) return b.status;

  const problems: string[] = [];
  if (t.orderNumber !== reference) problems.push("order number mismatch");
  if (!t.isPaid || t.status !== 3) problems.push(`not paid (${t.statusDescription ?? t.status})`);
  if ((t.currency ?? "").toUpperCase() !== "MYR") problems.push(`currency ${t.currency}`);
  if (!(Number(t.subtotal) >= PRICE_MYR - 0.001)) problems.push(`amount ${t.subtotal}`);
  const student = (b as any).students;
  if (t.payerEmail && student?.email && t.payerEmail.toLowerCase() !== student.email.toLowerCase())
    problems.push("payer email differs");
  const verified = problems.length === 0 || (problems.length === 1 && problems[0] === "payer email differs");

  await sb.from("payments").upsert({
    order_number: reference, booking_reference: reference, amount: t.amount, subtotal: t.subtotal,
    currency: t.currency, status: t.statusDescription ?? String(t.status), is_paid: t.isPaid,
    verification_result: problems.length ? problems.join("; ") : "verified",
    verified_at: new Date().toISOString(), audit: t.raw as any,
  }, { onConflict: "order_number" });

  if (!t.isPaid) {
    if (t.status === 2) await sb.from("bookings").update({ payment_status: "failed" }).eq("id", b.id).neq("status", "confirmed");
    return b.status;
  }
  if (!verified) {
    await sb.from("bookings").update({ status: "needs_resolution", payment_status: "paid", resolution_note: problems.join("; ") }).eq("id", b.id);
    await sb.from("payments").update({ resolution_status: "flagged" }).eq("order_number", reference);
    return "needs_resolution";
  }

  // Atomic: claim processing so two concurrent calls don't double-process.
  const { data: claim } = await sb.from("payments").update({ processed_at: new Date().toISOString() })
    .eq("order_number", reference).is("processed_at", null).select("id");
  const { data: result, error } = await sb.rpc("confirm_booking", { _bid: b.id });
  if (error) throw error;
  if (result === "needs_resolution") {
    await sb.from("payments").update({ resolution_status: "flagged" }).eq("order_number", reference);
    return "needs_resolution";
  }
  if (claim?.length || result === "confirmed" || result === "already_confirmed") await fulfil(b.id);
  return "confirmed";
}

/** Ensure the class has one Calendar event + Meet link. Never duplicates. */
export async function ensureClassEvent(classId: string) {
  const sb = await db();
  const { data: c } = await sb.from("class_sessions").select("*").eq("id", classId).single();
  if (!c) throw new Error("class not found");
  if (c.calendar_event_id && c.meet_link) return c;
  try {
    let id = c.calendar_event_id as string | null;
    let meet: string | null = null;
    if (!id) {
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
    await sb.from("class_sessions").update({ event_status: "failed", event_error: errMsg(e) }).eq("id", classId);
    throw e;
  }
}

/** After confirmation: events, attendees, then one confirmation email. */
export async function fulfil(bookingId: string) {
  const sb = await db();
  const { data: b } = await sb.from("bookings").select("*, students(*), booking_classes(position, attendee_added, class_id, class_sessions(*))").eq("id", bookingId).single();
  if (!b || b.status !== "confirmed") return;
  const student = (b as any).students;
  const rows = ((b as any).booking_classes as any[]).sort((x, y) => x.position - y.position);
  let calOk = true;
  for (const r of rows) {
    try {
      const c = await ensureClassEvent(r.class_id);
      if (!r.attendee_added) {
        await calAddAttendee(c.calendar_event_id!, student.email);
        await sb.from("booking_classes").update({ attendee_added: true }).eq("booking_id", bookingId).eq("class_id", r.class_id);
      }
    } catch (e) {
      calOk = false;
      await sb.from("bookings").update({ calendar_status: "failed", calendar_error: errMsg(e) }).eq("id", bookingId);
    }
  }
  if (calOk) await sb.from("bookings").update({ calendar_status: "done", calendar_error: null }).eq("id", bookingId);

  // Email only once all four Meet links exist.
  const { data: classes } = await sb.from("booking_classes").select("position, class_sessions(class_date, meet_link)").eq("booking_id", bookingId).order("position");
  const links = (classes ?? []).map((x: any) => x.class_sessions);
  if (links.length !== 4 || links.some((l: any) => !l.meet_link)) return;
  await sendConfirmationEmail(bookingId, student, b.reference, links, false);
}

export async function sendConfirmationEmail(
  bookingId: string, student: { name: string; email: string }, reference: string,
  links: { class_date: string; meet_link: string }[], force: boolean,
) {
  const sb = await db();
  // Reserve the (booking, type) row; unique constraint prevents duplicates.
  const { data: existing } = await sb.from("email_logs").select("*").eq("booking_id", bookingId).eq("email_type", "confirmation").maybeSingle();
  if (existing?.status === "sent" && !force) return "already_sent";
  if (existing?.status === "sending" && !force && Date.now() - Date.parse(existing.created_at) < 5 * 60e3) return "in_progress";
  if (!existing) {
    const { error } = await sb.from("email_logs").insert({ booking_id: bookingId, recipient: student.email, email_type: "confirmation", status: "sending" });
    if (error) return "in_progress";
  } else {
    await sb.from("email_logs").update({ status: "sending", error: null }).eq("id", existing.id);
  }
  try {
    await gmailSend(student.email, "Your Teacher Sha Speaking Club Booking Is Confirmed!", confirmationHtml(student.name, reference, links));
    await sb.from("email_logs").update({ status: "sent", sent_at: new Date().toISOString() }).eq("booking_id", bookingId).eq("email_type", "confirmation");
    return "sent";
  } catch (e) {
    await sb.from("email_logs").update({ status: "failed", error: errMsg(e) }).eq("booking_id", bookingId).eq("email_type", "confirmation");
    return "failed";
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function confirmationHtml(name: string, reference: string, links: { class_date: string; meet_link: string }[]) {
  const items = links.map((l, i) =>
    `<li style="margin:0 0 12px"><b>${fmtEn(l.class_date)}</b> (${fmtMs(l.class_date)})<br><a href="${esc(l.meet_link)}">${esc(l.meet_link)}</a></li>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:Arial,sans-serif;color:#222">
<div style="max-width:560px;margin:0 auto;padding:24px">
<h1 style="font-size:22px">Your Teacher Sha Speaking Club Booking Is Confirmed! 🍓</h1>
<p>Hi ${esc(name)},</p>
<p>Your RM49 payment was received successfully. Thank you!</p>
<p><b>Booking Reference:</b> ${esc(reference)}</p>
<p><b>Your four classes:</b></p><ol style="padding-left:20px">${items}</ol>
<p><b>Class time:</b> Every Tuesday, 8 PM–9 PM (Malaysia time), on Google Meet.</p>
<p style="background:#fff6d6;padding:12px;border-radius:8px"><b>Each Tuesday has its own unique Google Meet link.</b> Please use the correct link for each class. You will also receive Google Calendar invitations.</p>
<p><b>Booking policies:</b></p><ul>
<li>RM49 is a one-time payment for 4 consecutive Tuesday classes. There is no automatic subscription.</li>
<li>All four dates are reserved together. A new RM49 payment is needed for another 4-class package.</li>
<li>No refund after class 1 of 4 starts, but your slot can be transferred to 1 other person.</li>
<li>A class is forfeited if no student attends within 15 minutes.</li>
<li>Class times are fixed. If you miss a class, there is no replacement class.</li>
<li>If Teacher Sha cannot attend, a replacement date and recording will be given.</li>
<li>Maximum 10 students per Tuesday.</li></ul>
<p>See you in class!<br>Teacher Sha</p></div></body></html>`;
}

/** Tuesday 2 PM: one reminder per confirmed student for today's class. */
export async function runClassReminders(now = new Date()) {
  const sb = await db();
  const p = mytParts(now);
  if (p.dow !== 2 || p.hour < 14 || p.hour >= 20) return { skipped: "outside Tuesday 2–8 PM MYT" };
  const { data: cls } = await sb.from("class_sessions").select("*").eq("class_date", p.date).maybeSingle();
  if (!cls) return { sent: 0 };
  const { data: rows } = await sb.from("booking_classes")
    .select("booking_id, bookings!inner(id, status, payment_status, student_id, students!inner(*))")
    .eq("class_id", cls.id).eq("bookings.status", "confirmed").eq("bookings.payment_status", "paid");
  let sent = 0;
  for (const r of rows ?? []) {
    const b: any = (r as any).bookings, s = b.students;
    if (!s.whatsapp_consent || !s.whatsapp || !s.active) continue;
    const ok = await sendOnce({
      type: "class_reminder", booking_id: b.id, student_id: s.id, class_date: p.date, whatsapp_number: s.whatsapp,
      scheduled_for: `${p.date}T14:00:00+08:00`,
    }, async () => {
      const c = cls.meet_link ? cls : await ensureClassEvent(cls.id);
      if (!c.meet_link) throw new Error("Meet link missing for this class");
      return waSendTemplate(s.whatsapp, TEMPLATE_CLASS, [s.name, fmtEn(p.date), c.meet_link]);
    });
    if (ok) sent++;
  }
  return { sent };
}

/** Wednesday 10 AM after final class: one reminder for eligible continuing students. */
export async function runRenewalReminders(now = new Date()) {
  const sb = await db();
  const p = mytParts(now);
  if (p.dow !== 3 || p.hour !== 10) return { skipped: "outside Wednesday 10 AM MYT" };
  // The final class was yesterday, start + 21; today is start + 22.
  const { data: pkgs } = await sb.from("bookings").select("id, start_date, status, payment_status, student_id, students(*)")
    .eq("status", "confirmed").eq("payment_status", "paid").eq("start_date", addDays(p.date, -22));
  let sent = 0;
  for (const pkg of pkgs ?? []) {
    const s: any = (pkg as any).students;
    const { data: history } = await sb.from("bookings").select("start_date, status, payment_status").eq("student_id", pkg.student_id)
      .in("status", ["confirmed", "needs_resolution", "held", "expired"]);
    const elig = renewalEligibility(pkg as any, (history ?? []) as any, now, s);
    if (!elig.eligible) {
      if (elig.reason === "renewed") await sb.from("notifications").update({ status: "cancelled", error: "renewed" }).eq("type", "renewal").eq("booking_id", pkg.id).in("status", ["scheduled", "failed"]);
      continue;
    }
    const ok = await sendOnce({
      type: "renewal", booking_id: pkg.id, student_id: s.id, class_date: addDays(pkg.start_date, 21), whatsapp_number: s.whatsapp,
      scheduled_for: `${p.date}T10:00:00+08:00`,
    }, () => waSendTemplate(s.whatsapp, TEMPLATE_RENEWAL, [s.name, `${SITE_URL}/#daftar`]));
    if (ok) sent++;
  }
  return { sent };
}

/** Idempotent send: (type, booking, class_date) unique row, retried up to 3 times when failed. */
export async function sendOnce(
  row: { type: string; booking_id: string; student_id: string; class_date: string; whatsapp_number: string; scheduled_for: string },
  send: () => Promise<string | undefined>,
): Promise<boolean> {
  const sb = await db();
  const { data: ex } = await sb.from("notifications").select("*").eq("type", row.type).eq("booking_id", row.booking_id).eq("class_date", row.class_date).maybeSingle();
  if (ex && (ex.status === "sent" || ex.status === "cancelled" || ex.status === "sending" || ex.attempts >= 3)) return false;
  if (!ex) {
    const { error } = await sb.from("notifications").insert({ ...row, status: "sending", attempts: 1 });
    if (error) return false; // another run claimed it
  } else {
    const { data: claimed } = await sb.from("notifications").update({ status: "sending", attempts: ex.attempts + 1 }).eq("id", ex.id).eq("status", ex.status).select("id");
    if (!claimed?.length) return false;
  }
  try {
    const id = await send();
    await sb.from("notifications").update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: id ?? null, error: null })
      .eq("type", row.type).eq("booking_id", row.booking_id).eq("class_date", row.class_date);
    return true;
  } catch (e) {
    await sb.from("notifications").update({ status: "failed", error: errMsg(e) })
      .eq("type", row.type).eq("booking_id", row.booking_id).eq("class_date", row.class_date);
    return false;
  }
}

/** Every-10-minutes housekeeping: expire holds, poll BCL for pending payments, retry fulfilment. */
export async function runTick() {
  const sb = await db();
  const { data: expired } = await sb.rpc("expire_holds");
  const since = new Date(Date.now() - 3 * 864e5).toISOString();
  const { data: pending } = await sb.from("bookings").select("reference").in("status", ["held", "expired"])
    .neq("payment_status", "paid").gte("created_at", since).limit(40);
  let checked = 0;
  for (const b of pending ?? []) {
    try { await verifyBookingPayment(b.reference, "poll"); checked++; } catch (e) { console.error("poll", b.reference, errMsg(e)); }
  }
  const { data: retry } = await sb.from("bookings").select("id").eq("status", "confirmed").neq("calendar_status", "done").limit(20);
  for (const b of retry ?? []) { try { await fulfil(b.id); } catch (e) { console.error("fulfil", errMsg(e)); } }
  const { data: mailRetry } = await sb.from("email_logs").select("booking_id").eq("status", "failed").limit(20);
  for (const m of mailRetry ?? []) { if (m.booking_id) try { await fulfil(m.booking_id); } catch {} }
  return { expired, checked };
}

export { toCompact };
