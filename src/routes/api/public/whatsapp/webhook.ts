import { createFileRoute } from "@tanstack/react-router";

// Meta WhatsApp Cloud API webhook: delivery statuses + STOP opt-outs.
export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      // Meta's one-time subscription check.
      GET: ({ request }) => {
        const u = new URL(request.url).searchParams;
        const token = process.env["WHATSAPP_VERIFY_TOKEN"];
        if (token && u.get("hub.mode") === "subscribe" && u.get("hub.verify_token") === token) {
          return new Response(u.get("hub.challenge") ?? "", { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      },
      POST: async ({ request }) => {
        const raw = await request.text();
        const { verifyMetaSignature } = await import("@/lib/server/integrations.server");
        if (!(await verifyMetaSignature(raw, request.headers.get("x-hub-signature-256")))) {
          return new Response("Invalid signature", { status: 401 });
        }
        try {
          const { handleWhatsappWebhook } = await import("@/lib/server/pipeline.server");
          await handleWhatsappWebhook(raw, JSON.parse(raw));
          return Response.json({ ok: true });
        } catch (e) {
          console.error("WhatsApp webhook failed", e);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
