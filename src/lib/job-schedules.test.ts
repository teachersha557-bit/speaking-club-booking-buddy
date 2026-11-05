import { describe, expect, it } from "vitest";
import { JOB_SCHEDULES } from "./job-schedules";

describe("requested automatic checks", () => {
  it("checks payments every 10 minutes", () => {
    expect(JOB_SCHEDULES.payments).toBe("*/10 * * * *");
  });
  it("runs Tuesday at 2 PM MYT (6 AM UTC)", () => {
    expect(JOB_SCHEDULES.class_reminders).toBe("0 6 * * 2");
  });
  it("runs Wednesday at 10 AM MYT (2 AM UTC)", () => {
    expect(JOB_SCHEDULES.renewal_reminders).toBe("0 2 * * 3");
  });
});