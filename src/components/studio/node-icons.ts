import { Braces, Download, Mail, GitBranch, Globe, Image as ImageIcon, MessageSquareText, Sparkles, TextCursorInput, type LucideIcon } from "lucide-react";
import type { NodeType } from "@/lib/workflow/schema";

export const NODE_ICONS: Record<NodeType, LucideIcon> = {
  input: TextCursorInput,
  prompt_template: MessageSquareText,
  ai_text: Sparkles,
  ai_image: ImageIcon,
  condition: GitBranch,
  transform: Braces,
  http_request: Globe,
  send_email: Mail,
  output: Download,
};

/** Accent per category, used sparingly (icon chip only). */
export const NODE_TONES: Record<NodeType, string> = {
  input: "text-sky-300 bg-sky-400/10",
  prompt_template: "text-[var(--ob-accent-2)] bg-primary/10",
  ai_text: "text-[var(--ob-accent-2)] bg-primary/10",
  ai_image: "text-[var(--ob-accent-2)] bg-primary/10",
  condition: "text-amber-300 bg-amber-400/10",
  transform: "text-teal-300 bg-teal-400/10",
  http_request: "text-teal-300 bg-teal-400/10",
  send_email: "text-rose-300 bg-rose-400/10",
  output: "text-emerald-300 bg-emerald-400/10",
};
