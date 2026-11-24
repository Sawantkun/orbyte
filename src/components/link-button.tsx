import Link from "next/link";
import { Button } from "@/components/ui/button";

type Props = React.ComponentProps<typeof Button> & { href: string };

/** A Button rendered as a Next.js link. */
export function LinkButton({ href, children, ...props }: Props) {
  return (
    <Button {...props} asChild>
      <Link href={href}>{children}</Link>
    </Button>
  );
}
