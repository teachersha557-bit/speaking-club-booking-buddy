// Shared helper for the scheduled functions: calls this site's protected job
// endpoint with the CRON_SECRET. All job logic lives in the main app so it is
// identical on Netlify and Lovable.
export async function runJob(kind: "payments" | "class_reminders" | "renewal_reminders") {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.error(`[${kind}] URL or CRON_SECRET missing; job skipped`);
    return new Response("not configured", { status: 500 });
  }
  const res = await fetch(`${base}/api/public/jobs/automation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ kind }),
  });
  const text = await res.text();
  console.log(`[${kind}] ${res.status} ${text.slice(0, 500)}`);
  return new Response(null, { status: res.ok ? 200 : 500 });
}
