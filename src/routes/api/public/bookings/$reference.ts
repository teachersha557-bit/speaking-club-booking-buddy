import { createFileRoute } from "@tanstack/react-router";
import { REF_RE } from "@/lib/booking-rules";
import { json, preflight } from "@/lib/http";

// GET /api/public/bookings/TSC-XXXXXX — status for the Netlify booking page (no personal data).
export const Route = createFileRoute("/api/public/bookings/$reference")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => preflight(request),
      GET: async ({ request, params }) => {
        const ref = String(params.reference ?? "").toUpperCase();
        if (!REF_RE.test(ref)) return json(request, { ok: false, error: "INVALID_REFERENCE" }, 400);
        try {
          const { getPublicBooking } = await import("@/lib/server/pipeline.server");
          const b = await getPublicBooking(ref);
          if (!b) return json(request, { ok: false, error: "NOT_FOUND" }, 404);
          return json(request, { ok: true, booking: b });
        } catch (e) {
          console.error("booking status failed", e);
          return json(request, { ok: false, error: "SERVER_ERROR" }, 500);
        }
      },
    },
  },
});
