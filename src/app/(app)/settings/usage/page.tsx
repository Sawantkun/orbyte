import type { Metadata } from "next";
import { Gauge } from "lucide-react";
import { MilestoneNotice } from "@/components/milestone-notice";

export const metadata: Metadata = { title: "Usage" };

export default function UsagePage() {
  return (
    <MilestoneNotice
      icon={Gauge}
      title="Usage tracking"
      milestone={5}
      description="Token usage and estimated spend per provider and model, recorded from real executions."
      capabilities={["Tokens by provider & model", "Estimated spend", "Per-execution breakdown", "Configurable pricing"]}
    />
  );
}
