import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  cancelBookingFn, flagPayment, getIntegrationStatus, recheckPayment, resendEmail, resolveWebhook,
  retryFulfil, retryWhatsapp, runHousekeeping,
} from "@/lib/admin.functions";
import { addDays, fmtEn, isCurrentStudent, mytParts, packageDates, renewalPreview, renewalSendTime } from "@/lib/schedule";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Bookings dashboard — Teacher Sha" },
      { name: "description", content: "Classes, bookings, payments and messages." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short" }) : "—");
const short = (d: string) => fmtEn(d).replace("Tuesday, ", "Tue ");
const holdActive = (b: any) => b?.status === "held" && b.hold_expires_at && Date.parse(b.hold_expires_at) > Date.now();
const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" =>
  ["confirmed", "sent", "delivered", "read", "ready", "done", "verified", "processed", "resolved"].includes(s) ? "default"
  : ["failed", "needs_resolution", "error", "unmatched", "flagged"].includes(s) ? "destructive" : "secondary";

function csv(rows: Record<string, unknown>[], name: string) {
  if (!rows.length) { toast.error("Nothing to export"); return; }
  const cols = Object.keys(rows[0]!);
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const text = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function AdminPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const role = useQuery({
    queryKey: ["is-admin"],
    queryFn: async () => {
      const { data: u, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!u.user) return { admin: false, email: undefined };
      const { data, error } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
      if (error) throw error;
      return { admin: !!data, email: u.user?.email };
    },
  });
  const admin = !!role.data?.admin;
  const today = mytParts(new Date()).date;

  const classes = useQuery({
    queryKey: ["classes"], enabled: admin,
    queryFn: async () => {
      const { data, error } = await supabase.from("class_sessions")
        .select("*, booking_classes(booking_id, attendee_added, bookings(id, reference, status, hold_expires_at, students(name, email, whatsapp)))")
        .gte("class_date", addDays(today, -7)).order("class_date").limit(16);
      if (error) throw error; return data as any[];
    },
  });
  const bookings = useQuery({
    queryKey: ["bookings"], enabled: admin,
    queryFn: async () => {
      const { data, error } = await supabase.from("bookings")
        .select("*, students(id, name, email, whatsapp, whatsapp_consent, active), booking_classes(position, class_sessions(class_date, meet_link)), email_logs(status, sent_at, error)")
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error; return data as any[];
    },
  });
  const students = useQuery({
    queryKey: ["students"], enabled: admin,
    queryFn: async () => {
      const { data, error } = await supabase.from("students").select("*, bookings(id, reference, start_date, status, payment_status)").order("created_at", { ascending: false }).limit(1000);
      if (error) throw error; return data as any[];
    },
  });
  const payments = useQuery({
    queryKey: ["payments"], enabled: admin,
    queryFn: async () => {
      const { data, error } = await supabase.from("payments").select("*").order("created_at", { ascending: false }).limit(500);
      if (error) throw error; return data as any[];
    },
  });
  const webhooks = useQuery({
    queryKey: ["webhooks"], enabled: admin,
    queryFn: async () => {
      const { data, error } = await supabase.from("webhook_logs").select("id, source, event_type, order_number, booking_reference, status, error, created_at, payload").order("created_at", { ascending: false }).limit(200);
      if (error) throw error; return data as any[];
    },
  });
  const messages = useQuery({
    queryKey: ["messages"], enabled: admin,
    queryFn: async () => {
      const { data, error } = await supabase.from("notifications").select("*, students(name), bookings(reference)").order("created_at", { ascending: false }).limit(300);
      if (error) throw error; return data as any[];
    },
  });
  const emails = useQuery({
    queryKey: ["emails"], enabled: admin,
    queryFn: async () => {
      const { data, error } = await supabase.from("email_logs").select("*, bookings(reference)").order("created_at", { ascending: false }).limit(300);
      if (error) throw error; return data as any[];
    },
  });
  const setup = useQuery({ queryKey: ["setup"], enabled: admin, queryFn: () => getIntegrationStatus() });

  async function signOut() {
    await qc.cancelQueries(); qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }
  async function act(p: PromiseLike<any>, ok: string) {
    try { const r = await p; toast.success(r?.status ? `${ok}: ${r.status}` : ok); } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    qc.invalidateQueries();
  }

  // ---- derived data ----
  const q = search.trim().toLowerCase();
  const match = (...v: (string | null | undefined)[]) => !q || v.some((x) => (x ?? "").toLowerCase().includes(q));
  const allBookings = bookings.data ?? [];
  const allStudents = students.data ?? [];

  const pkgsByStudent = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const s of allStudents) m.set(s.id, (s.bookings ?? []).filter((b: any) => b.payment_status === "paid" && ["confirmed", "needs_resolution"].includes(b.status)));
    return m;
  }, [allStudents]);

  const renewalRows = useMemo(() => {
    const rows: any[] = [];
    for (const s of allStudents) {
      const paid = pkgsByStudent.get(s.id) ?? [];
      const latest = [...paid].filter((p) => p.status === "confirmed").sort((a, b) => (a.start_date < b.start_date ? 1 : -1))[0];
      if (!latest) continue;
      const elig = renewalPreview(latest, paid, s);
      rows.push({ student: s, pkg: latest, final: addDays(latest.start_date, 21), sendAt: renewalSendTime(latest.start_date), ...elig });
    }
    return rows.sort((a, b) => a.sendAt.getTime() - b.sendAt.getTime());
  }, [allStudents, pkgsByStudent]);
  const sentRenewals = new Set((messages.data ?? []).filter((m) => m.type === "renewal" && ["sent", "delivered", "read"].includes(m.status)).map((m) => m.booking_id));
  const pendingRenewals = renewalRows.filter((r) => r.eligible && r.sendAt.getTime() > Date.now() - 3600e3 && !sentRenewals.has(r.pkg.id));

  const confirmed = allBookings.filter((b) => b.status === "confirmed");
  const upcoming = (classes.data ?? []).filter((c) => c.class_date >= today);
  const paidStudentsUpcoming = new Set(upcoming.flatMap((c) => (c.booking_classes ?? []).filter((x: any) => x.bookings?.status === "confirmed").map((x: any) => x.bookings.id))).size;
  const activeCount = allStudents.filter((s) => s.active && isCurrentStudent((pkgsByStudent.get(s.id) ?? []).map((p) => p.start_date), new Date())).length;
  const pendingVerification = allBookings.filter((b) => holdActive(b) || b.status === "needs_resolution").length;
  const revenue = (payments.data ?? []).filter((p) => p.is_paid && p.processed_at).reduce((n, p) => n + Number(p.subtotal ?? 0), 0);
  const unmatched = (webhooks.data ?? []).filter((w) => ["unmatched", "needs_resolution", "error"].includes(w.status));
  const failedIntegrations =
    (classes.data ?? []).filter((c) => c.event_status === "failed").length +
    allBookings.filter((b) => b.status === "confirmed" && b.calendar_status === "failed").length +
    (emails.data ?? []).filter((e) => e.status === "failed").length +
    (messages.data ?? []).filter((m) => m.status === "failed").length + unmatched.length;

  if (role.isLoading) return <p className="p-8 text-muted-foreground">Loading…</p>;
  if (role.isError) return <main className="p-8"><p className="text-destructive">Could not check your access.</p><Button className="mt-4" onClick={() => role.refetch()}>Try again</Button></main>;
  if (!admin) return (
    <main className="p-8">
      <p className="text-foreground">{role.data?.email} is not an admin account.</p>
      <Button className="mt-4" variant="outline" onClick={signOut}>Sign out</Button>
    </main>
  );

  const anyError = [classes, bookings, students, payments, webhooks, messages, emails].find((x) => x.isError);

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Teacher Sha — Bookings dashboard</h1>
          <p className="text-sm text-muted-foreground">{role.data?.email} · times in Malaysia (MYT)</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input className="w-56" placeholder="Search name, email, ref, phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button variant="outline" onClick={() => act(runHousekeeping(), "Checks run")}>Run checks now</Button>
          <Button variant="outline" onClick={() => qc.invalidateQueries()}>Refresh</Button>
          <Button variant="outline" onClick={signOut}>Sign out</Button>
        </div>
      </header>
      {anyError && <p role="alert" className="mb-4 text-destructive">Some records could not load: {(anyError.error as any)?.message}</p>}

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        <Stat label="Upcoming Tuesdays" value={upcoming.length} />
        <Stat label="Paid students (upcoming)" value={paidStudentsUpcoming} />
        <Stat label="Current students" value={activeCount} />
        <Stat label="Awaiting payment / review" value={pendingVerification} />
        <Stat label="Total bookings" value={allBookings.length} />
        <Stat label="Confirmed bookings" value={confirmed.length} />
        <Stat label="Revenue (verified)" value={`RM${revenue.toFixed(0)}`} />
        <Stat label="Problems" value={failedIntegrations} danger={failedIntegrations > 0} />
      </section>

      <Tabs defaultValue="classes">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="classes">Classes</TabsTrigger>
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="students">Students</TabsTrigger>
          <TabsTrigger value="payments">Payments {unmatched.length > 0 && <Badge variant="destructive" className="ml-1">{unmatched.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="messages">WhatsApp</TabsTrigger>
          <TabsTrigger value="emails">Emails</TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
        </TabsList>

        {/* ---------------- Classes ---------------- */}
        <TabsContent value="classes" className="space-y-3">
          {(classes.data ?? []).length === 0 && <p className="p-4 text-sm text-muted-foreground">No classes have bookings yet.</p>}
          {(classes.data ?? []).map((c) => {
            const rows = (c.booking_classes ?? []).filter((x: any) => x.bookings);
            const paid = rows.filter((x: any) => x.bookings.status === "confirmed");
            const held = rows.filter((x: any) => holdActive(x.bookings));
            const reminders = (messages.data ?? []).filter((m) => m.type === "class_reminder" && m.class_date === c.class_date);
            return (
              <Card key={c.id} className={c.class_date < today ? "opacity-60" : ""}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {fmtEn(c.class_date)} · 8:00–9:00 PM
                    <Badge>{paid.length} / {c.capacity} paid</Badge>
                    <Badge variant="secondary">{Math.max(0, c.capacity - paid.length - held.length)} seats left</Badge>
                    {held.length > 0 && <Badge variant="outline">{held.length} on hold</Badge>}
                    <Badge variant={statusVariant(c.event_status)}>Calendar: {c.event_status}</Badge>
                    <Badge variant="outline">WhatsApp: {reminders.filter((m) => ["sent", "delivered", "read"].includes(m.status)).length} sent{reminders.some((m) => m.status === "failed") ? `, ${reminders.filter((m) => m.status === "failed").length} failed` : ""}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>Meet: {c.meet_link ? <a className="text-primary underline" href={c.meet_link} target="_blank" rel="noreferrer">{c.meet_link}</a> : "— (created after the first paid booking)"}</div>
                  <div className="text-xs text-muted-foreground">Calendar event ID: {c.calendar_event_id ?? "—"}{c.event_error && <span className="text-destructive"> · {c.event_error}</span>}</div>
                  {paid.length > 0 && (
                    <ol className="list-decimal pl-5">
                      {paid.map((x: any) => (
                        <li key={x.booking_id}>{x.bookings.students?.name} · {x.bookings.students?.email} · {x.bookings.students?.whatsapp} · <span className="font-mono">{x.bookings.reference}</span>{!x.attendee_added && <span className="text-destructive"> (not yet in calendar)</span>}</li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ---------------- Bookings ---------------- */}
        <TabsContent value="bookings">
          <div className="mb-2 flex justify-end">
            <Button size="sm" variant="outline" onClick={() => csv(allBookings.map((b) => ({
              reference: b.reference, name: b.students?.name, email: b.students?.email, whatsapp: b.students?.whatsapp,
              start_date: b.start_date, dates: packageDates(b.start_date).join(" "), price: b.price, status: b.status,
              payment_status: b.payment_status, payment_mode: b.payment_mode, calendar: b.calendar_status,
              confirmation_email: (b.email_logs ?? [])[0]?.status ?? "", created_at: b.created_at, confirmed_at: b.confirmed_at ?? "", note: b.resolution_note ?? "",
            })), "bookings")}>Export CSV</Button>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Student</TableHead><TableHead>Four Tuesdays &amp; Meet links</TableHead><TableHead>Status</TableHead><TableHead>Calendar / Email</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {allBookings.filter((b) => match(b.reference, b.students?.name, b.students?.email, b.students?.whatsapp)).map((b) => {
                const links = [...(b.booking_classes ?? [])].sort((x: any, y: any) => x.position - y.position);
                const mail = (b.email_logs ?? [])[0];
                const shownStatus = b.status === "held" && !holdActive(b) ? "expired" : b.status;
                return (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono">{b.reference}<div className="text-xs text-muted-foreground">{fmt(b.created_at)}</div></TableCell>
                    <TableCell>{b.students?.name}<div className="text-xs text-muted-foreground">{b.students?.email}<br />{b.students?.whatsapp}</div></TableCell>
                    <TableCell className="text-xs">
                      {links.map((l: any) => <div key={l.position}>{short(l.class_sessions?.class_date)} — {l.class_sessions?.meet_link ? <a className="text-primary underline" href={l.class_sessions.meet_link} target="_blank" rel="noreferrer">Meet</a> : "no link yet"}</div>)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(shownStatus)}>{shownStatus}</Badge>
                      <div className="text-xs text-muted-foreground">payment: {b.payment_status} ({b.payment_mode})</div>
                      {holdActive(b) && <div className="text-xs text-muted-foreground">hold until {fmt(b.hold_expires_at)}</div>}
                      {b.resolution_note && <div className="text-xs text-destructive">{b.resolution_note}</div>}
                    </TableCell>
                    <TableCell className="text-xs">
                      calendar: {b.calendar_status}{b.calendar_error && <div className="text-destructive">{b.calendar_error}</div>}
                      <div>email: {mail ? `${mail.status}${mail.sent_at ? ` ${fmt(mail.sent_at)}` : ""}` : "—"}</div>
                      {mail?.error && <div className="text-destructive">{mail.error}</div>}
                    </TableCell>
                    <TableCell className="space-y-1">
                      {b.status !== "confirmed" && b.status !== "cancelled" && <ActionButton label="Check payment" onClick={() => act(recheckPayment({ data: { reference: b.reference } }), "Payment checked")} />}
                      {b.status === "needs_resolution" && <ActionButton label="Verify BCL order…" onClick={() => {
                        const order = window.prompt(`BCL order number for ${b.reference} (leave blank to use ${b.reference}):`, "")?.trim();
                        if (order === undefined) return;
                        const ok = window.confirm("Have you confirmed this payment belongs to this student? (Amount, MYR and paid status will still be verified with BCL.)");
                        act(recheckPayment({ data: { reference: b.reference, ...(order ? { orderNumber: order } : {}), identityOverride: ok } }), "Verified");
                      }} />}
                      {b.status === "confirmed" && b.calendar_status !== "done" && <ActionButton label="Retry calendar" onClick={() => act(retryFulfil({ data: { bookingId: b.id } }), "Retried")} />}
                      {b.status === "confirmed" && <ActionButton label="Resend email" onClick={() => window.confirm(`Resend the confirmation email to ${b.students?.email}?`) && act(resendEmail({ data: { bookingId: b.id } }), "Email")} />}
                      {b.status !== "cancelled" && <ActionButton label="Cancel" danger onClick={() => {
                        const reason = window.prompt(`Cancel ${b.reference}? This frees the seats and removes the student from the calendar events. Reason:`);
                        if (reason !== null) act(cancelBookingFn({ data: { bookingId: b.id, reason } }), "Booking");
                      }} />}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {allBookings.length === 0 && <p className="p-4 text-sm text-muted-foreground">No bookings yet.</p>}
        </TabsContent>

        {/* ---------------- Students ---------------- */}
        <TabsContent value="students">
          <div className="mb-2 flex justify-end">
            <Button size="sm" variant="outline" onClick={() => csv(allStudents.map((s) => ({
              name: s.name, email: s.email, whatsapp: s.whatsapp, whatsapp_consent: s.whatsapp_consent, active: s.active,
              packages: (pkgsByStudent.get(s.id) ?? []).map((p) => p.start_date).join(" "), created_at: s.created_at,
            })), "students")}>Export CSV</Button>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Student</TableHead><TableHead>WhatsApp</TableHead><TableHead>Package history</TableHead><TableHead>Status</TableHead><TableHead>Renewal</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {allStudents.filter((s) => match(s.name, s.email, s.whatsapp, ...(s.bookings ?? []).map((b: any) => b.reference))).map((s) => {
                const paid = (pkgsByStudent.get(s.id) ?? []).sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
                const current = isCurrentStudent(paid.map((p) => p.start_date), new Date());
                const r = renewalRows.find((x) => x.student.id === s.id);
                return (
                  <TableRow key={s.id}>
                    <TableCell>{s.name}<div className="text-xs text-muted-foreground">{s.email}</div></TableCell>
                    <TableCell className="text-xs">{s.whatsapp ?? "—"}<div>{s.whatsapp_consent ? "consented" : "no consent / opted out"}</div></TableCell>
                    <TableCell className="text-xs">
                      {paid.length === 0 ? "no paid package" : paid.map((p) => <div key={p.id}><span className="font-mono">{p.reference}</span> {short(p.start_date)} → {short(addDays(p.start_date, 21))}</div>)}
                      {(s.bookings ?? []).filter((b: any) => b.payment_status !== "paid").length > 0 && <div className="text-muted-foreground">+{(s.bookings ?? []).filter((b: any) => b.payment_status !== "paid").length} unpaid</div>}
                    </TableCell>
                    <TableCell><Badge variant={s.active && current ? "default" : "secondary"}>{!s.active ? "inactive (manual)" : current ? "current" : "former"}</Badge></TableCell>
                    <TableCell className="text-xs">{r ? <>{r.eligible ? "eligible" : `not eligible: ${r.reason}`}<div className="text-muted-foreground">{sentRenewals.has(r.pkg.id) ? "reminder sent" : `send time ${fmt(r.sendAt.toISOString())}`}</div></> : "—"}</TableCell>
                    <TableCell className="space-y-1">
                      <ActionButton label={s.active ? "Mark inactive" : "Mark active"} onClick={() => act(supabase.from("students").update({ active: !s.active }).eq("id", s.id).then(({ error }) => { if (error) throw error; }), "Saved")} />
                      {s.whatsapp_consent && <ActionButton label="Opt out of WhatsApp" onClick={() => window.confirm(`Stop all WhatsApp messages to ${s.name}?`) && act(supabase.from("students").update({ whatsapp_consent: false }).eq("id", s.id).then(({ error }) => { if (error) throw error; }), "Opted out")} />}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TabsContent>

        {/* ---------------- Payments ---------------- */}
        <TabsContent value="payments" className="space-y-6">
          <section>
            <h2 className="mb-2 font-medium">Needs attention (unmatched / flagged notifications)</h2>
            {unmatched.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to resolve.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Received</TableHead><TableHead>Order / Ref</TableHead><TableHead>Problem</TableHead><TableHead>Payload</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {unmatched.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="text-xs">{fmt(w.created_at)}<div>{w.source} · {w.event_type}</div></TableCell>
                      <TableCell className="font-mono text-xs">{w.order_number ?? "—"}<br />{w.booking_reference ?? "—"}</TableCell>
                      <TableCell className="text-xs"><Badge variant="destructive">{w.status}</Badge><div className="text-destructive">{w.error}</div></TableCell>
                      <TableCell className="max-w-xs text-xs"><details><summary>show</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(w.payload, null, 1)}</pre></details></TableCell>
                      <TableCell className="space-y-1">
                        <ActionButton label="Match to booking…" onClick={() => {
                          const ref = window.prompt("Booking reference (TSC-XXXXXX) this payment belongs to:", w.booking_reference ?? "")?.trim().toUpperCase();
                          if (!ref) return;
                          const order = window.prompt("BCL order number:", w.order_number ?? ref)?.trim();
                          if (!order) return;
                          const ok = window.confirm("Have you confirmed the payer is this student? (BCL will still verify amount, MYR and paid status.)");
                          act(recheckPayment({ data: { reference: ref, orderNumber: order, identityOverride: ok } }).then(async (r) => { if (r.status === "confirmed") await resolveWebhook({ data: { id: w.id } }); return r; }), "Result");
                        }} />
                        <ActionButton label="Mark resolved" onClick={() => act(resolveWebhook({ data: { id: w.id } }), "Resolved")} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-medium">Verified BCL transactions</h2>
              <Button size="sm" variant="outline" onClick={() => csv((payments.data ?? []).map((p) => ({
                order_number: p.order_number, booking_reference: p.booking_reference, amount: p.amount, subtotal: p.subtotal, currency: p.currency,
                status: p.status, paid: p.is_paid, verification: p.verification_result, verified_at: p.verified_at, processed_at: p.processed_at, resolution: p.resolution_status,
              })), "payments")}>Export CSV</Button>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>BCL order</TableHead><TableHead>Booking / student</TableHead><TableHead>Amount</TableHead><TableHead>BCL status</TableHead><TableHead>Verification</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {(payments.data ?? []).filter((p) => {
                  const b = allBookings.find((x) => x.reference === p.booking_reference);
                  return match(p.order_number, p.booking_reference, b?.students?.name, b?.students?.email);
                }).map((p) => {
                  const b = allBookings.find((x) => x.reference === p.booking_reference);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.order_number}</TableCell>
                      <TableCell className="text-xs"><span className="font-mono">{p.booking_reference}</span><div>{b?.students?.name}</div></TableCell>
                      <TableCell className="text-xs">{p.currency} {p.subtotal}{p.amount !== p.subtotal && <div className="text-muted-foreground">charged {p.amount}</div>}</TableCell>
                      <TableCell className="text-xs">{p.status}<div>{p.is_paid ? "paid" : "not paid"}</div></TableCell>
                      <TableCell className="text-xs">{p.verification_result}<div className="text-muted-foreground">{fmt(p.verified_at)}</div>{p.resolution_status !== "none" && <Badge variant={statusVariant(p.resolution_status)}>{p.resolution_status}</Badge>}</TableCell>
                      <TableCell className="space-y-1">
                        {p.resolution_status !== "flagged" && <ActionButton label="Flag" onClick={() => { const note = window.prompt("Why does this payment need manual resolution?"); if (note) act(flagPayment({ data: { orderNumber: p.order_number, flag: "flagged", note } }), "Flagged"); }} />}
                        {p.resolution_status === "flagged" && <ActionButton label="Mark resolved" onClick={() => act(flagPayment({ data: { orderNumber: p.order_number, flag: "resolved" } }), "Resolved")} />}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>
        </TabsContent>

        {/* ---------------- WhatsApp ---------------- */}
        <TabsContent value="messages" className="space-y-6">
          {setup.data && !setup.data.whatsappLive && <p className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">WhatsApp sending is OFF. It turns on only when WhatsApp credentials are set and WHATSAPP_LIVE=true (after Meta approves both templates and you have tested them).</p>}
          <section>
            <h2 className="mb-2 font-medium">Renewal reminders — upcoming / eligibility</h2>
            <Table>
              <TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Latest package</TableHead><TableHead>Send time</TableHead><TableHead>Eligibility</TableHead></TableRow></TableHeader>
              <TableBody>
                {renewalRows.filter((r) => r.sendAt.getTime() > Date.now() - 14 * 864e5 && match(r.student.name, r.student.email)).map((r) => (
                  <TableRow key={r.pkg.id}>
                    <TableCell>{r.student.name}</TableCell>
                    <TableCell className="text-xs"><span className="font-mono">{r.pkg.reference}</span> final class {short(r.final)}</TableCell>
                    <TableCell className="text-xs">{fmt(r.sendAt.toISOString())}</TableCell>
                    <TableCell className="text-xs">{sentRenewals.has(r.pkg.id) ? <Badge>sent</Badge> : r.eligible ? <Badge variant="secondary">will send</Badge> : <span className="text-muted-foreground">no — {r.reason}</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-1 text-xs text-muted-foreground">{pendingRenewals.length} pending renewal reminder(s).</p>
          </section>
          <section>
            <h2 className="mb-2 font-medium">Message log</h2>
            <Table>
              <TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Type</TableHead><TableHead>Class / package end</TableHead><TableHead>Number</TableHead><TableHead>Status</TableHead><TableHead>Sent</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {(messages.data ?? []).filter((m) => match(m.students?.name, m.whatsapp_number, m.bookings?.reference)).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.students?.name}<div className="font-mono text-xs">{m.bookings?.reference}</div></TableCell>
                    <TableCell>{m.type === "class_reminder" ? "Class reminder (2 PM)" : "Renewal"}</TableCell>
                    <TableCell>{m.class_date}</TableCell>
                    <TableCell className="text-xs">{m.whatsapp_number}</TableCell>
                    <TableCell><Badge variant={statusVariant(m.status)}>{m.status}</Badge> <span className="text-xs text-muted-foreground">×{m.attempts}</span>{m.error && <div className="text-xs text-destructive">{m.error}</div>}</TableCell>
                    <TableCell className="text-xs">{fmt(m.sent_at)}</TableCell>
                    <TableCell>{m.status === "failed" && <ActionButton label="Retry" onClick={() => act(retryWhatsapp({ data: { notificationId: m.id } }), "WhatsApp")} />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(messages.data ?? []).length === 0 && <p className="p-4 text-sm text-muted-foreground">No WhatsApp messages yet.</p>}
          </section>
        </TabsContent>

        {/* ---------------- Emails ---------------- */}
        <TabsContent value="emails">
          <Table>
            <TableHeader><TableRow><TableHead>Booking</TableHead><TableHead>To</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Sent</TableHead></TableRow></TableHeader>
            <TableBody>
              {(emails.data ?? []).filter((e) => match(e.recipient, e.bookings?.reference)).map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs">{e.bookings?.reference}</TableCell>
                  <TableCell>{e.recipient}</TableCell><TableCell>{e.email_type}</TableCell>
                  <TableCell><Badge variant={statusVariant(e.status)}>{e.status}</Badge> <span className="text-xs text-muted-foreground">×{e.attempts ?? 1}</span>{e.error && <div className="text-xs text-destructive">{e.error}</div>}</TableCell>
                  <TableCell>{fmt(e.sent_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(emails.data ?? []).length === 0 && <p className="p-4 text-sm text-muted-foreground">No emails yet.</p>}
        </TabsContent>

        {/* ---------------- Setup ---------------- */}
        <TabsContent value="setup">
          {setup.isError && <p className="text-destructive">{(setup.error as any)?.message}</p>}
          {setup.data && (
            <ul className="space-y-2 text-sm">
              <SetupRow ok={setup.data.database} label="Database (server key)" />
              <SetupRow ok={setup.data.bclVerify} label={`BCL API verification${setup.data.bclTestMode ? " — TEST MODE" : " — live"}`} />
              <SetupRow ok={setup.data.bclLinks} label="BCL per-booking payment links (otherwise students use the BCL form)" optional />
              <li className="pl-6 text-xs text-muted-foreground">BCL form fallback: {setup.data.bclFormUrl}</li>
              <SetupRow ok={setup.data.calendar} label={`Google Calendar + Meet (${setup.data.googleMode})`} />
              <SetupRow ok={setup.data.gmail} label="Gmail confirmation email" />
              <SetupRow ok={setup.data.whatsapp} label="WhatsApp Cloud API credentials" />
              <SetupRow ok={setup.data.whatsappLive} label="WhatsApp sending switched ON (WHATSAPP_LIVE)" optional />
              <SetupRow ok={setup.data.whatsappWebhook} label="WhatsApp delivery webhook" optional />
              <SetupRow ok={setup.data.cron} label="Scheduled jobs secret (CRON_SECRET)" />
            </ul>
          )}
          <p className="mt-4 text-xs text-muted-foreground">See DEPLOY-NETLIFY.md in the project for how to set each one up.</p>
        </TabsContent>
      </Tabs>
    </main>
  );
}

function Stat({ label, value, danger }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className={`text-2xl font-semibold ${danger ? "text-destructive" : "text-foreground"}`}>{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function ActionButton({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return <Button size="sm" variant={danger ? "destructive" : "outline"} className="mr-1 h-7 px-2 text-xs" onClick={onClick}>{label}</Button>;
}

function SetupRow({ ok, label, optional }: { ok: boolean; label: string; optional?: boolean }) {
  return <li className="flex items-center gap-2"><span>{ok ? "✅" : optional ? "⚪" : "❌"}</span>{label}</li>;
}
