import Link from "next/link";
import { OrbyteMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <OrbyteMark className="mb-6 size-10" />
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist or was moved.</p>
      <Button className="mt-6" asChild>
        <Link href="/dashboard">Go to overview</Link>
      </Button>
    </div>
  );
}
