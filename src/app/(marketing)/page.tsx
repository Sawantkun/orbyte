import Link from "next/link";
import { ArrowRight, Boxes, FolderKanban, Workflow } from "lucide-react";
import { OrbyteLogo, OrbyteMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/server/session";

const pillars = [
  {
    icon: Workflow,
    title: "Create & connect",
    body: "Compose AI workflows visually. Chain prompts, models, conditions and HTTP calls into a graph that runs reliably in the background.",
  },
  {
    icon: Boxes,
    title: "Generate & organize",
    body: "Every output a workflow produces lands in your asset library with its prompt, model and source execution attached.",
  },
  {
    icon: FolderKanban,
    title: "Reuse",
    body: "Tag, collect and search everything AI creates. The library stands on its own, with or without workflows.",
  },
];

export default async function LandingPage() {
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <OrbyteLogo />
        <nav className="flex items-center gap-2">
          {user ? (
            <Button asChild>
              <Link href="/dashboard">
                Open workspace <ArrowRight />
              </Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild>
                <Link href="/signup">Get started</Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto flex max-w-3xl flex-col items-center px-6 pt-20 pb-24 text-center sm:pt-28">
          <div className="mb-8 rounded-2xl border border-border bg-card p-4">
            <OrbyteMark className="size-10" />
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Create. Connect. <span className="text-[var(--ob-accent-2)]">Organize.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">
            Orbyte is an intelligent workspace that connects AI workflows, automates creative processes, and
            organizes everything AI creates.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button size="lg" className="h-10 px-4" asChild>
              <Link href={user ? "/dashboard" : "/signup"}>
                {user ? "Go to dashboard" : "Create your workspace"} <ArrowRight />
              </Link>
            </Button>
            {!user && (
              <Button size="lg" variant="outline" className="h-10 px-4" asChild>
                <Link href="/login">Sign in</Link>
              </Button>
            )}
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 md:grid-cols-3">
          {pillars.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border border-border bg-card p-6">
              <div className="mb-4 inline-flex size-9 items-center justify-center rounded-lg bg-primary/10 text-[var(--ob-accent-2)]">
                <Icon className="size-4.5" />
              </div>
              <h2 className="font-medium">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Orbyte</span>
          <span>Create → Connect → Automate → Generate → Organize → Reuse</span>
        </div>
      </footer>
    </div>
  );
}
