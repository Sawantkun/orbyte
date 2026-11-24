import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { features, type FeatureKey } from "@/config/features";

type Props = React.ComponentProps<typeof Button> & { href: string; feature?: FeatureKey };

/** A link button that renders disabled, with an explanation, until its feature ships. */
export function FeatureButton({ href, feature, children, ...props }: Props) {
  const f = feature ? features[feature] : null;
  if (f && !f.available) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-lg">
            <Button {...props} disabled aria-disabled>
              {children}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Coming in Milestone {f.milestone}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Button {...props} asChild>
      <Link href={href}>{children}</Link>
    </Button>
  );
}
