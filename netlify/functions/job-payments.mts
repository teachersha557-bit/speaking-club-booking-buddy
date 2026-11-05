import { runJob } from "../lib/run-job.mts";

// Every 10 minutes: release expired 20-minute holds, re-check pending BCL
// payments, retry Calendar invites and confirmation emails.
export default () => runJob("payments");
export const config = { schedule: "*/10 * * * *" };
