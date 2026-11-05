// Schedules are UTC; Malaysia is UTC+8 year-round.
// On Netlify these are set in netlify/functions/job-*.mts (kept in sync by a test).
export const JOB_SCHEDULES = {
  payments: "*/10 * * * *",
  class_reminders: "0,15,30 6 * * 2", // Tue 2:00 PM MYT + retries of failed sends at 2:15 / 2:30
  renewal_reminders: "0,30 2 * * 3", // Wed 10:00 AM MYT + retry at 10:30
} as const;
