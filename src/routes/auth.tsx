import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Teacher Sha Admin" },
      { name: "description", content: "Sign in to the Teacher Sha Speaking Club admin." },
      { property: "og:title", content: "Sign in — Teacher Sha Admin" },
      { property: "og:description", content: "Sign in to the Teacher Sha Speaking Club admin." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/admin", replace: true });
    });
  }, [navigate]);

  async function signIn() {
    setBusy(true);
    const res = await lovable.auth.signInWithOAuth("google", { redirect_uri: `${window.location.origin}/auth` });
    if (res?.error) { toast.error(String(res.error.message ?? res.error)); setBusy(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8 text-center">
        <h1 className="text-xl font-semibold text-card-foreground">Admin sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">Use Teacher Sha's Google account.</p>
        <Button className="mt-6 w-full" onClick={signIn} disabled={busy}>Continue with Google</Button>
      </div>
    </main>
  );
}
