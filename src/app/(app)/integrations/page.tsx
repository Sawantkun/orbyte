import type { Metadata } from "next";
import { Blocks } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MilestoneNotice } from "@/components/milestone-notice";

export const metadata: Metadata = { title: "Integrations" };

export default function Page() {
  return (
    <>
      <PageHeader title="Integrations" />
      <MilestoneNotice
        icon={Blocks}
        title="Integrations"
        milestone={5}
        description="Connect your own AI provider keys. Keys are encrypted at rest and never sent back to the browser."
        capabilities={["OpenAI first, more providers later", "Encrypted API key storage", "Credential validation", "Usage & spend tracking"]}
      />
    </>
  );
}
