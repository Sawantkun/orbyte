import { Braces, Code2, File, FileArchive, FileText, FileType2, Film, Image as ImageIcon, Music, type LucideIcon } from "lucide-react";

export const KIND_ICONS: Record<string, LucideIcon> = {
  IMAGE: ImageIcon,
  VIDEO: Film,
  AUDIO: Music,
  PDF: FileType2,
  DOCUMENT: FileText,
  TEXT: FileText,
  JSON: Braces,
  CODE: Code2,
  OTHER: File,
};

export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = KIND_ICONS[kind] ?? FileArchive;
  return <Icon className={className} aria-hidden />;
}
