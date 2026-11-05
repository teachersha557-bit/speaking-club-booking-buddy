import { createFileRoute } from "@tanstack/react-router";
import { bookingInput } from "@/lib/booking-rules";
import { json, preflight, readBody } from "@/lib/http";

// POST /api/public/bookings — called by the existing Netlify registration form.
export const Route = createFileRoute("/api/public/bookings/")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => preflight(request),
      POST: async ({ request }) => {
        const { data } = await readBody(request);
        const parsed = bookingInput.safeParse(data);
        if (!parsed.success) {
          return json(request, { ok: false, error: "INVALID_INPUT", issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) }, 400);
        }
        if (parsed.data.website) return json(request, { ok: false, error: "INVALID_INPUT" }, 400);
        try {
          const { createBooking } = await import("@/lib/server/pipeline.server");
          const r = await createBooking({
            name: parsed.data.name, email: parsed.data.email, whatsapp: parsed.data.whatsapp,
            whatsapp_consent: parsed.data.whatsapp_consent, start: parsed.data.start, reference: parsed.data.reference,
          });
          const status = r.ok ? (r.existing ? 200 : 201) : r.error === "RATE_LIMIT" ? 429 : r.error === "INVALID_DATE" ? 400 : 409;
          return json(request, r, status);
        } catch (e) {
          console.error("create booking failed", e);
          return json(request, { ok: false, error: "SERVER_ERROR" }, 500);
        }
      },
    },
  },
});
