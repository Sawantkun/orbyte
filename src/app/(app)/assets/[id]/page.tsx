import type { Metadata } from "next";
import { Boxes } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MilestoneNotice } from "@/components/milestone-notice";

export const metadata: Metadata = { title: "Asset" };

export default function Page() {
  return (
    <>
      <PageHeader title="Asset" />
      <MilestoneNotice
        icon={Boxes}
        title="The asset library"
        milestone={4}
        description="Upload files and collect everything your workflows generate, with prompts and provenance attached."
        capabilities={["Upload, preview, download", "Tags, favorites, search", "Grid & list views, bulk actions", "Automatic workflow outputs"]}
      />
    </>
  );
}
