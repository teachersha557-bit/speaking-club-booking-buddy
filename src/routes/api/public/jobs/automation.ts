import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

const jobInput = z.object({
  kind: z.enum(["payments", "class_reminders", "renewal_reminders"]),
}).strict();

export const Route = createFileRoute("/api/public/jobs/automation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const parsed = jobInput.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "Invalid job" }, { status: 400 });
        if (parsed.data.kind !== "payments") {
          // Do not activate unconnected/unapproved WhatsApp sends.
          return Response.json({ error: "WhatsApp setup and delivery verification are pending" }, { status: 503 });
        }
        try {
          const { runTick } = await import("@/lib/server/pipeline.server");
          const result = await runTick();
          return Response.json({ ok: true, ...result });
        } catch (error) {
          console.error("Automation job failed", error);
          return Response.json({ error: "Automation failed" }, { status: 500 });
        }
      },
    },
  },
});