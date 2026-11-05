import { createFileRoute } from "@tanstack/react-router";
import { readBody } from "@/lib/http";

// POST /api/public/bcl/webhook — BCL payment notification.
// The body is only used to find which booking to check; every payment is
// re-verified directly with the BCL API before anything is confirmed.
export const Route = createFileRoute("/api/public/bcl/webhook")({
  server: {
    handlers: {
      GET: () => Response.json({ ok: true, info: "BCL webhook endpoint. Use POST." }),
      POST: async ({ request }) => {
        const key = process.env["BCL_WEBHOOK_KEY"];
        if (key && new URL(request.url).searchParams.get("key") !== key) return new Response("Unauthorized", { status: 401 });
        const { raw, data } = await readBody(request);
        try {
          const { handleBclWebhook } = await import("@/lib/server/pipeline.server");
          const r = await handleBclWebhook(raw, data);
          return Response.json({ ok: true, ...r });
        } catch (e) {
          console.error("BCL webhook failed", e);
          // 500 lets BCL retry; the 10-minute job also re-checks pending payments.
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
