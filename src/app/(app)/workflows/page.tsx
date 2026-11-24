import type { Metadata } from "next";
import { Workflow } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MilestoneNotice } from "@/components/milestone-notice";

export const metadata: Metadata = { title: "Workflows" };

export default function Page() {
  return (
    <>
      <PageHeader title="Workflows" />
      <MilestoneNotice
        icon={Workflow}
        title="Workflow Studio"
        milestone={2}
        description="Build, version and validate AI workflows on a visual canvas."
        capabilities={["Visual node editor", "Prompt, AI, condition & HTTP nodes", "Versioning & undo/redo", "Graph validation"]}
      />
    </>
  );
}
