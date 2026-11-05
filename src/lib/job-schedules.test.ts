import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JOB_SCHEDULES } from "./job-schedules";

const fn = (name: string) => readFileSync(`netlify/functions/${name}.mts`, "utf8");

describe("requested automatic checks", () => {
  it("checks payments every 10 minutes", () => {
    expect(JOB_SCHEDULES.payments).toBe("*/10 * * * *");
  });
  it("first class reminder run is Tuesday at 2 PM MYT (6 AM UTC)", () => {
    expect(JOB_SCHEDULES.class_reminders.split(" ").slice(0, 2)).toEqual(["0,15,30", "6"]);
    expect(JOB_SCHEDULES.class_reminders.endsWith("* * 2")).toBe(true);
  });
  it("renewal reminder runs Wednesday at 10 AM MYT (2 AM UTC)", () => {
    expect(JOB_SCHEDULES.renewal_reminders).toBe("0,30 2 * * 3");
  });
  it("Netlify scheduled functions use the same schedules", () => {
    expect(fn("job-payments")).toContain(`schedule: "${JOB_SCHEDULES.payments}"`);
    expect(fn("job-class-reminders")).toContain(`schedule: "${JOB_SCHEDULES.class_reminders}"`);
    expect(fn("job-renewal-reminders")).toContain(`schedule: "${JOB_SCHEDULES.renewal_reminders}"`);
  });
});
