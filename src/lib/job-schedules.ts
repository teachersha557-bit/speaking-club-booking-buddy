// Schedules are UTC; Malaysia is UTC+8 year-round.
export const JOB_SCHEDULES = {
  payments: "*/10 * * * *",
  class_reminders: "0 6 * * 2",
  renewal_reminders: "0 2 * * 3",
} as const;