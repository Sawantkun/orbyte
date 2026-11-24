import Link from "next/link";
import { OrbyteLogo } from "@/components/brand/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-10" aria-label="Orbyte home">
        <OrbyteLogo />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
