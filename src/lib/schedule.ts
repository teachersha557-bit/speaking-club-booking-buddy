// Pure date rules for Teacher Sha Speaking Club. All calendar dates are
// "YYYY-MM-DD" strings in Malaysia time (Asia/Kuala_Lumpur, UTC+8, no DST).

export const TZ = "Asia/Kuala_Lumpur";
export const CUTOFF_HOUR = 20; // on a Tuesday at/after 8 PM, start next week
export const PACKAGE_SIZE = 4;
export const CAPACITY = 10;
export const PRICE_MYR = 49;
export const RENEWAL_GAP_DAYS = 30; // gap >= one month breaks continuity

const MYT_OFFSET_MS = 8 * 3600 * 1000;

/** Malaysia wall-clock parts for an instant. */
export function mytParts(now: Date) {
  const d = new Date(now.getTime() + MYT_OFFSET_MS);
  return {
    date: d.toISOString().slice(0, 10),
    hour: d.getUTCHours(),
    dow: d.getUTCDay(), // 0 Sun .. 2 Tue
  };
}

export function addDays(date: string, days: number): string {
  const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
  return new Date(t + days * 864e5).toISOString().slice(0, 10);
}

export function dayOfWeek(date: string): number {
  return new Date(date + "T00:00:00Z").getUTCDay();
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
}

/** First Tuesday a new booking may start on (same rule as the Netlify site). */
export function nextEligibleTuesday(now: Date): string {
  const p = mytParts(now);
  let add = (2 - p.dow + 7) % 7;
  if (add === 0 && p.hour >= CUTOFF_HOUR) add = 7;
  return addDays(p.date, add);
}

export function packageDates(start: string): string[] {
  return Array.from({ length: PACKAGE_SIZE }, (_, i) => addDays(start, i * 7));
}

/** A start date is valid if it's a Tuesday, not before the next eligible one, within 12 weeks. */
export function isValidStart(start: string, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || dayOfWeek(start) !== 2) return false;
  const first = nextEligibleTuesday(now);
  const diff = daysBetween(first, start);
  return diff >= 0 && diff <= 84;
}

/** "20261110" -> "2026-11-10" */
export function fromCompact(s: string): string | null {
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}
export function toCompact(d: string): string {
  return d.replace(/-/g, "");
}

/** Class start instant (8 PM MYT) for a date. */
export function classStart(date: string): Date {
  return new Date(Date.parse(date + "T20:00:00+08:00"));
}

export interface PackageLite {
  start_date: string;
  status: string; // confirmed | ...
  payment_status: string;
}

/**
 * Renewal reminder eligibility for one completed package.
 * - package must be finished (last class ended)
 * - no later paid package exists (not renewed)
 * - continuity: if there was a previous package, the gap between it and this one < 1 month
 * - reminder window: within 7 days after the final class (stale packages never revive)
 */
export function renewalEligibility(
  pkg: PackageLite,
  allPaid: PackageLite[],
  now: Date,
  student: { active: boolean; whatsapp_consent: boolean; whatsapp: string | null },
): { eligible: boolean; reason: string } {
  const last = addDays(pkg.start_date, 21);
  const lastEnd = Date.parse(last + "T21:00:00+08:00");
  if (now.getTime() < lastEnd) return { eligible: false, reason: "package not finished" };
  if (now.getTime() - lastEnd > 7 * 864e5) return { eligible: false, reason: "too long ago" };
  if (!student.active) return { eligible: false, reason: "inactive" };
  if (!student.whatsapp_consent || !student.whatsapp) return { eligible: false, reason: "no consent" };
  const paid = allPaid.filter((p) => p.payment_status === "paid");
  if (paid.some((p) => p.start_date > pkg.start_date)) return { eligible: false, reason: "renewed" };
  const prev = paid
    .filter((p) => p.start_date < pkg.start_date)
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1))[0];
  if (prev) {
    const gap = daysBetween(addDays(prev.start_date, 21), pkg.start_date) - 7;
    if (gap >= RENEWAL_GAP_DAYS) return { eligible: false, reason: "gap of a month or more" };
  }
  return { eligible: true, reason: "continuing student" };
}

/** Normalise a Malaysian / international phone number to E.164. */
export function toE164(raw: string): string | null {
  let s = raw.replace(/[\s\-().]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("00")) s = s.slice(2);
  else if (s.startsWith("0")) s = "60" + s.slice(1);
  if (!/^\d{9,15}$/.test(s)) return null;
  return "+" + s;
}

const MS = ["Januari","Februari","Mac","April","Mei","Jun","Julai","Ogos","September","Oktober","November","Disember"];
const MEN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
export function fmtMs(date: string) {
  return `Selasa, ${+date.slice(8, 10)} ${MS[+date.slice(5, 7) - 1]} ${date.slice(0, 4)}`;
}
export function fmtEn(date: string) {
  return `Tuesday, ${+date.slice(8, 10)} ${MEN[+date.slice(5, 7) - 1]} ${date.slice(0, 4)}`;
}
