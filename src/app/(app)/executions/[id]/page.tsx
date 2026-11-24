import type { Metadata } from "next";
import { Play } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MilestoneNotice } from "@/components/milestone-notice";

export const metadata: Metadata = { title: "Execution" };

export default function Page() {
  return (
    <>
      <PageHeader title="Execution" />
      <MilestoneNotice
        icon={Play}
        title="Execution history"
        milestone={3}
        description="Workflows run in a background worker; every run and node is logged here."
        capabilities={["Run history & status", "Per-node inputs, outputs, logs", "Token usage & cost", "Cancel & retry"]}
      />
    </>
  );
}
