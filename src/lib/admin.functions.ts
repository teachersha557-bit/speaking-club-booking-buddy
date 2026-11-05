import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const REF = z.string().regex(/^TSC-[A-Z0-9]{6}$/);

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error || !data) throw new Error("Not an admin");
}

/** Re-check a booking's payment with BCL (order number = reference, or a BCL order number from the BCL form). */
export const recheckPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ reference: REF, orderNumber: z.string().trim().min(3).max(100).optional(), identityOverride: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { verifyPayment } = await import("@/lib/server/pipeline.server");
    const status = await verifyPayment({
      reference: data.reference, source: "admin",
      ...(data.orderNumber ? { orderNumber: data.orderNumber } : {}),
      ...(data.identityOverride ? { identityOverride: true } : {}),
      deadline: Date.now() + 15000,
    });
    return { status };
  });

export const retryFulfil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ bookingId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { fulfil } = await import("@/lib/server/pipeline.server");
    await fulfil(data.bookingId, Date.now() + 20000);
    return { ok: true };
  });

export const resendEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ bookingId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { resendConfirmation } = await import("@/lib/server/pipeline.server");
    return { status: await resendConfirmation(data.bookingId) };
  });

export const retryWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ notificationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { retryNotification } = await import("@/lib/server/pipeline.server");
    return { status: await retryNotification(data.notificationId) };
  });

export const cancelBookingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ bookingId: z.string().uuid(), reason: z.string().max(300).default("") }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { cancelBooking } = await import("@/lib/server/pipeline.server");
    return { status: await cancelBooking(data.bookingId, data.reason) };
  });

export const flagPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderNumber: z.string().min(1).max(100), flag: z.enum(["flagged", "resolved", "none"]), note: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { setPaymentFlag } = await import("@/lib/server/pipeline.server");
    await setPaymentFlag(data.orderNumber, data.flag, data.note);
    return { ok: true };
  });

export const resolveWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { setWebhookResolved } = await import("@/lib/server/pipeline.server");
    await setWebhookResolved(data.id);
    return { ok: true };
  });

/** Which integrations are connected (booleans only, no secrets). */
export const getIntegrationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { integrationStatus } = await import("@/lib/server/integrations.server");
    return integrationStatus();
  });

/** Runs the 10-minute housekeeping job now (expire holds, poll BCL, retry calendar/email). */
export const runHousekeeping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { runTick } = await import("@/lib/server/pipeline.server");
    return runTick(20_000);
  });
