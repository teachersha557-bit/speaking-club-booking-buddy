import { createFileRoute } from "@tanstack/react-router";
import { json, preflight } from "@/lib/http";

// GET /api/public/availability — remaining seats for upcoming Tuesdays.
export const Route = createFileRoute("/api/public/availability")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => preflight(request),
      GET: async ({ request }) => {
        try {
          const { getAvailability } = await import("@/lib/server/pipeline.server");
          const weeks = Math.min(26, Math.max(1, Number(new URL(request.url).searchParams.get("weeks")) || 12));
          return json(request, { ok: true, classes: await getAvailability(new Date(), weeks) }, 200, { "Cache-Control": "public, max-age=30" });
        } catch (e) {
          console.error("availability failed", e);
          return json(request, { ok: false, error: "SERVER_ERROR" }, 500);
        }
      },
    },
  },
});
