import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Teacher Sha Speaking Club — Admin" },
      { name: "description", content: "Private admin area for Teacher Sha Speaking Club bookings." },
      { property: "og:title", content: "Teacher Sha Speaking Club — Admin" },
      { property: "og:description", content: "Private admin area for Teacher Sha Speaking Club bookings." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-semibold text-foreground">Teacher Sha Speaking Club</h1>
        <p className="mt-3 text-muted-foreground">
          Private booking admin. Students book on the main website.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild><Link to="/admin">Open admin</Link></Button>
          <Button asChild variant="outline"><a href="https://teachershaspeaking.netlify.app">Main website</a></Button>
        </div>
      </div>
    </main>
  );
}
