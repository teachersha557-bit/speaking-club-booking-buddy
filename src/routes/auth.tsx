import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Teacher Sha Admin" },
      { name: "description", content: "Sign in to the Teacher Sha Speaking Club admin." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AuthPage,
});

const onLovable = () => typeof window !== "undefined" && /lovable\.(app|dev)$|lovableproject\.com$/.test(window.location.hostname);

function AuthPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    const go = () => navigate({ to: "/admin", replace: true });
    supabase.auth.getUser().then(({ data }) => { if (data.user) go(); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => { if (session?.user) go(); });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/auth`, shouldCreateUser: true },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setSent(true);
    toast.success("Check your email for the sign-in link or code.");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) toast.error(error.message);
  }

  async function google() {
    setBusy(true);
    const res = await lovable.auth.signInWithOAuth("google", { redirect_uri: `${window.location.origin}/auth` });
    if (res?.error) { toast.error(String(res.error.message ?? res.error)); setBusy(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8 text-center">
        <h1 className="text-xl font-semibold text-card-foreground">Admin sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">Only Teacher Sha's admin email can open the dashboard.</p>
        {!sent ? (
          <form onSubmit={sendCode} className="mt-6 space-y-3">
            <Input type="email" required placeholder="you@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <Button className="w-full" type="submit" disabled={busy}>Email me a sign-in link</Button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-6 space-y-3">
            <p className="text-sm text-muted-foreground">Open the link we sent to {email}, or type the code from the email here:</p>
            <Input inputMode="numeric" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />
            <Button className="w-full" type="submit" disabled={busy || code.trim().length < 6}>Sign in with code</Button>
            <Button className="w-full" type="button" variant="ghost" onClick={() => setSent(false)}>Use a different email</Button>
          </form>
        )}
        {onLovable() && (
          <Button className="mt-4 w-full" variant="outline" onClick={google} disabled={busy}>Continue with Google</Button>
        )}
      </div>
    </main>
  );
}
