import { runJob } from "../lib/run-job.mts";

// Wednesday 10:00 AM Malaysia time (02:00 UTC), the morning after a package's
// fourth class, plus one retry at 10:30. Each package gets at most one reminder.
export default () => runJob("renewal_reminders");
export const config = { schedule: "0,30 2 * * 3" };
