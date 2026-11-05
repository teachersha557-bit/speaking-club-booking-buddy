import { describe, expect, it } from "vitest";
import { REF_RE, bookingInput, extractReferences, generateReference, normaliseDate } from "./booking-rules";

describe("booking references", () => {
  it("generates TSC-XXXXXX references", () => {
    for (let i = 0; i < 200; i++) expect(generateReference()).toMatch(REF_RE);
  });
  it("finds references anywhere in a webhook body, de-duplicated and upper-cased", () => {
    expect(extractReferences('{"remarks":"tsc-a48d85 paid","ref":"TSC-A48D85","x":"TSC-ZZZZZZ9"}')).toEqual(["TSC-A48D85"]);
    expect(extractReferences("order_number=TSC-B2C3D4&status=3")).toEqual(["TSC-B2C3D4"]);
    expect(extractReferences("nothing here")).toEqual([]);
  });
});

describe("booking input", () => {
  const ok = { name: "Aisyah", email: " Aisyah@Gmail.com ", whatsapp: "012-345 6789", start: "20261110" };
  it("normalises email, phone and the compact start date from the booking URL", () => {
    const r = bookingInput.parse({ ...ok, whatsapp_consent: "on" });
    expect(r).toMatchObject({ email: "aisyah@gmail.com", whatsapp: "+60123456789", start: "2026-11-10", whatsapp_consent: true });
  });
  it("consent defaults to false", () => {
    expect(bookingInput.parse(ok).whatsapp_consent).toBe(false);
  });
  it("rejects bad phone, email and dates", () => {
    expect(bookingInput.safeParse({ ...ok, whatsapp: "abc" }).success).toBe(false);
    expect(bookingInput.safeParse({ ...ok, email: "nope" }).success).toBe(false);
    expect(bookingInput.safeParse({ ...ok, start: "10/11/2026" }).success).toBe(false);
    expect(normaliseDate("2026-11-10")).toBe("2026-11-10");
  });
  it("accepts the site's own reference and rejects malformed ones", () => {
    expect(bookingInput.parse({ ...ok, reference: "tsc-a48d85" }).reference).toBe("TSC-A48D85");
    expect(bookingInput.safeParse({ ...ok, reference: "TSC-1" }).success).toBe(false);
  });
});
