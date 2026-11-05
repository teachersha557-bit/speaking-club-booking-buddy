// Pure booking rules shared by the API routes and tests (no server imports).
import { z } from "zod";
import { fromCompact, toE164 } from "./schedule";

/** Booking reference format used by the Netlify site, e.g. TSC-A48D85. */
export const REF_RE = /^TSC-[A-Z0-9]{6}$/;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion when typed into BCL

export function generateReference(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return "TSC-" + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** All distinct booking references mentioned anywhere in a text (e.g. a webhook body). */
export function extractReferences(text: string): string[] {
  const found = text.toUpperCase().match(/TSC-[A-Z0-9]{6}(?![A-Z0-9])/g) ?? [];
  return [...new Set(found)];
}

/** Accepts "2026-11-10" or "20261110". */
export function normaliseDate(s: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return fromCompact(s);
}

export const bookingInput = z.object({
  name: z.string().trim().min(2, "Name is required").max(80),
  email: z.string().trim().toLowerCase().email("Valid email is required").max(160),
  whatsapp: z.string().trim().min(8, "WhatsApp number is required").max(24)
    .transform((v, ctx) => {
      const e = toE164(v);
      if (!e) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid WhatsApp number" }); return z.NEVER; }
      return e;
    }),
  whatsapp_consent: z.union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("false"), z.literal("yes")])
    .optional().transform((v) => v === true || v === "on" || v === "true" || v === "yes"),
  start: z.string().trim().transform((v, ctx) => {
    const d = normaliseDate(v);
    if (!d) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid start date" }); return z.NEVER; }
    return d;
  }),
  reference: z.string().trim().toUpperCase().regex(REF_RE).optional(),
  /** Honeypot: real users never fill this. */
  website: z.string().max(0).optional(),
});
export type BookingInput = z.infer<typeof bookingInput>;
