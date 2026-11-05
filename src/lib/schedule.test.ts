import { describe, it, expect } from "vitest";
import { nextEligibleTuesday, packageDates, isValidStart, renewalEligibility, toE164 } from "./schedule";

const at = (iso: string) => new Date(iso);
const student = { active: true, whatsapp_consent: true, whatsapp: "+60123456789" };
const paid = (start_date: string) => ({ start_date, status: "confirmed", payment_status: "paid" });

describe("schedule rules", () => {
  it("four consecutive Tuesdays from 10 Nov 2026", () => {
    expect(packageDates("2026-11-10")).toEqual(["2026-11-10", "2026-11-17", "2026-11-24", "2026-12-01"]);
  });
  it("Tuesday before 8 PM MYT starts today", () => {
    expect(nextEligibleTuesday(at("2026-11-10T11:59:00Z"))).toBe("2026-11-10"); // 19:59 MYT
  });
  it("Tuesday at 8 PM MYT moves to next week", () => {
    expect(nextEligibleTuesday(at("2026-11-10T12:00:00Z"))).toBe("2026-11-17");
  });
  it("rejects non-Tuesday and past starts", () => {
    expect(isValidStart("2026-11-11", at("2026-11-04T00:00:00Z"))).toBe(false);
    expect(isValidStart("2026-11-03", at("2026-11-04T00:00:00Z"))).toBe(false);
    expect(isValidStart("2026-11-10", at("2026-11-04T00:00:00Z"))).toBe(true);
  });
  it("normalises Malaysian numbers to +60", () => {
    expect(toE164("012-345 6789")).toBe("+60123456789");
  });
});

describe("renewal eligibility", () => {
  // package starting 10 Nov 2026 has its final class on Tue 1 Dec 2026
  const pkg = paid("2026-11-10");
  const at10am = at("2026-12-02T02:00:00Z"); // Wednesday 10 AM MYT

  it("eligible Wednesday at 10 AM after final Tuesday class", () => {
    expect(renewalEligibility(pkg, [paid("2026-10-13"), pkg], at10am, student).eligible).toBe(true);
  });
  it("too early before Wednesday 10 AM", () => {
    expect(renewalEligibility(pkg, [pkg], at("2026-12-02T01:59:00Z"), student).reason).toBe("before 10 AM");
  });
  it("never at night after the class", () => {
    expect(renewalEligibility(pkg, [pkg], at("2026-12-01T12:30:00Z"), student).eligible).toBe(false);
  });
  it("does not revive a missed Wednesday morning reminder", () => {
    expect(renewalEligibility(pkg, [pkg], at("2026-12-02T03:00:00Z"), student).eligible).toBe(false);
    expect(renewalEligibility(pkg, [pkg], at("2026-12-09T02:00:00Z"), student).eligible).toBe(false);
  });
  it("renewed student gets nothing", () => {
    expect(renewalEligibility(pkg, [pkg, paid("2026-12-08")], at10am, student).reason).toBe("renewed");
  });
  it("gap of one month or more gets nothing", () => {
    // previous package ended 22 Sep, next started 10 Nov: 49 days - 7 = 42 day gap
    expect(renewalEligibility(pkg, [paid("2026-09-01"), pkg], at10am, student).eligible).toBe(false);
  });
  it("inactive student gets nothing", () => {
    expect(renewalEligibility(pkg, [pkg], at10am, { ...student, active: false }).reason).toBe("inactive");
  });
  it("opted-out students get nothing", () => {
    expect(renewalEligibility(pkg, [pkg], at10am, { ...student, whatsapp_consent: false }).reason).toBe("no consent");
  });
});
