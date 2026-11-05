import { runJob } from "../lib/run-job.mts";

// Tuesday 2:00 PM Malaysia time (06:00 UTC), plus two safe retries at 2:15
// and 2:30 for messages that failed. Each student is messaged at most once.
export default () => runJob("class_reminders");
export const config = { schedule: "0,15,30 6 * * 2" };
