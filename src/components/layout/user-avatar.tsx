import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function UserAvatar({ name, image, className }: { name: string; image: string | null; className?: string }) {
  return (
    <Avatar className={cn("size-7", className)}>
      {image && <AvatarImage src={image} alt="" />}
      <AvatarFallback className="bg-primary/15 text-[11px] font-medium text-[var(--ob-accent-2)]">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
