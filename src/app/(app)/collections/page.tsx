import type { Metadata } from "next";
import { FolderKanban } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MilestoneNotice } from "@/components/milestone-notice";

export const metadata: Metadata = { title: "Collections" };

export default function Page() {
  return (
    <>
      <PageHeader title="Collections" />
      <MilestoneNotice
        icon={FolderKanban}
        title="Collections"
        milestone={4}
        description="Group assets into collections such as campaigns, clients or research."
        capabilities={["Create & rename collections", "Cover images", "Move assets between collections", "Deleting keeps the assets"]}
      />
    </>
  );
}
