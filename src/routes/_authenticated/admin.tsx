import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { recheckPayment, retryFulfil } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Bookings dashboard — Teacher Sha" },
      { name: "description", content: "Classes, bookings, payments and messages." },
      { property: "og:title", content: "Bookings dashboard — Teacher Sha" },
      { property: "og:description", content: "Classes, bookings, payments and messages." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPage,
});

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short" }) : "—");

function AdminPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
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
  const admin = role.data?.admin;
  const q = (key: string, fn: () => any) => useQuery({ queryKey: [key], queryFn: fn, enabled: !!admin });

  const classes = q("classes", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.from("class_sessions").select("*, booking_classes(booking_id, bookings(status))").gte("class_date", today).order("class_date").limit(12);
    if (error) throw error; return data;
  });
  const bookings = q("bookings", async () => {
    const { data, error } = await supabase.from("bookings").select("*, students(name, email, whatsapp)").order("created_at", { ascending: false }).limit(100);
    if (error) throw error; return data;
  });
  const messages = q("messages", async () => {
    const { data, error } = await supabase.from("notifications").select("*, students(name)").order("created_at", { ascending: false }).limit(100);
    if (error) throw error; return data;
  });
  const emails = q("emails", async () => {
    const { data, error } = await supabase.from("email_logs").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) throw error; return data;
  });

  async function signOut() {
    await qc.cancelQueries(); qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }
  async function act(p: Promise<any>, ok: string) {
    try { await p; toast.success(ok); qc.invalidateQueries(); } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  if (role.isLoading) return <p className="p-8 text-muted-foreground">Loading…</p>;
  if (role.isError) return <main className="p-8"><p className="text-destructive">Could not check your access.</p><Button className="mt-4" onClick={() => role.refetch()}>Try again</Button></main>;
  if (!admin) return (
    <main className="p-8">
      <p className="text-foreground">{role.data?.email} is not an admin account.</p>
      <Button className="mt-4" variant="outline" onClick={signOut}>Sign out</Button>
    </main>
  );

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Bookings dashboard</h1>
          <p className="text-sm text-muted-foreground">{role.data?.email}</p>
        </div>
        <Button variant="outline" onClick={signOut}>Sign out</Button>
      </header>
      {[classes, bookings, messages, emails].some((query) => query.isError) && <p role="alert" className="mb-4 text-destructive">Some records could not load. Please try again.</p>}

      <Tabs defaultValue="classes">
        <TabsList>
          <TabsTrigger value="classes">Classes</TabsTrigger>
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="messages">WhatsApp</TabsTrigger>
          <TabsTrigger value="emails">Emails</TabsTrigger>
        </TabsList>

        <TabsContent value="classes">
          <Table>
            <TableHeader><TableRow><TableHead>Tuesday</TableHead><TableHead>Paid</TableHead><TableHead>On hold</TableHead><TableHead>Meet</TableHead><TableHead>Calendar</TableHead></TableRow></TableHeader>
            <TableBody>
              {(classes.data ?? []).map((c: any) => {
                const st = (c.booking_classes ?? []).map((x: any) => x.bookings?.status);
                const paid = st.filter((s: string) => s === "confirmed").length;
                return (
                  <TableRow key={c.id}>
                    <TableCell>{c.class_date}</TableCell>
                    <TableCell>{paid} / {c.capacity}</TableCell>
                    <TableCell>{st.filter((s: string) => s === "held").length}</TableCell>
                    <TableCell>{c.meet_link ? <a className="text-primary underline" href={c.meet_link} target="_blank" rel="noreferrer">Link</a> : "—"}</TableCell>
                    <TableCell><Badge variant={c.event_status === "created" ? "default" : "secondary"}>{c.event_status}</Badge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {classes.data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">No upcoming classes have bookings yet.</p>}
        </TabsContent>

        <TabsContent value="bookings">
          <Table>
            <TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Student</TableHead><TableHead>Starts</TableHead><TableHead>Status</TableHead><TableHead>Calendar</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {(bookings.data ?? []).map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono">{b.reference}</TableCell>
                  <TableCell>{b.students?.name}<div className="text-xs text-muted-foreground">{b.students?.email}</div></TableCell>
                  <TableCell>{b.start_date}</TableCell>
                  <TableCell><Badge variant={b.status === "confirmed" ? "default" : "secondary"}>{b.status}</Badge>{b.resolution_note && <div className="text-xs text-destructive">{b.resolution_note}</div>}</TableCell>
                  <TableCell>{b.calendar_status}{b.calendar_error && <div className="text-xs text-destructive">{b.calendar_error}</div>}</TableCell>
                  <TableCell className="space-x-2 whitespace-nowrap">
                    {b.status !== "confirmed" && <Button size="sm" variant="outline" onClick={() => act(recheckPayment({ data: { reference: b.reference } }), "Payment re-checked")}>Check payment</Button>}
                    {b.status === "confirmed" && b.calendar_status !== "done" && <Button size="sm" variant="outline" onClick={() => act(retryFulfil({ data: { bookingId: b.id } }), "Retried")}>Retry invites</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {bookings.data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">No bookings yet.</p>}
        </TabsContent>

        <TabsContent value="messages">
          <Table>
            <TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Type</TableHead><TableHead>Class</TableHead><TableHead>Status</TableHead><TableHead>Sent</TableHead></TableRow></TableHeader>
            <TableBody>
              {(messages.data ?? []).map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell>{m.students?.name}</TableCell><TableCell>{m.type}</TableCell><TableCell>{m.class_date}</TableCell>
                  <TableCell>{m.status}{m.error && <div className="text-xs text-destructive">{m.error}</div>}</TableCell>
                  <TableCell>{fmt(m.sent_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="emails">
          <Table>
            <TableHeader><TableRow><TableHead>To</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Sent</TableHead></TableRow></TableHeader>
            <TableBody>
              {(emails.data ?? []).map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell>{e.recipient}</TableCell><TableCell>{e.email_type}</TableCell>
                  <TableCell>{e.status}{e.error && <div className="text-xs text-destructive">{e.error}</div>}</TableCell>
                  <TableCell>{fmt(e.sent_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </main>
  );
}
