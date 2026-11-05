import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkCronAuth } from "@/lib/http";

const jobInput = z.object({
  kind: z.enum(["payments", "class_reminders", "renewal_reminders"]),
}).strict();

// POST /api/public/jobs/automation — called by Netlify scheduled functions
// (or Lovable cron) with "Authorization: Bearer <CRON_SECRET>".
// WhatsApp jobs do nothing until WHATSAPP_LIVE=true (templates approved + tested).
export const Route = createFileRoute("/api/public/jobs/automation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await checkCronAuth(request);
        if (authFailure) return authFailure;
        const parsed = jobInput.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "Invalid job" }, { status: 400 });
        try {
          const p = await import("@/lib/server/pipeline.server");
          const result =
            parsed.data.kind === "payments" ? await p.runTick()
            : parsed.data.kind === "class_reminders" ? await p.runClassReminders()
            : await p.runRenewalReminders();
          return Response.json({ ok: true, kind: parsed.data.kind, ...result });
        } catch (error) {
          console.error("Automation job failed", error);
          return Response.json({ error: "Automation failed" }, { status: 500 });
        }
      },
    },
  },
});
