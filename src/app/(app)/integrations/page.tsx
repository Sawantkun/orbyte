import type { Metadata } from "next";
import { IntegrationsView } from "@/components/integrations/integrations-view";
import { PageHeader } from "@/components/layout/page-header";
import { INTEGRATION_PROVIDERS } from "@/config/integrations";
import { listIntegrations, platformKeyAvailable } from "@/server/integrations";
import { localClaudeStatus } from "@/server/local-claude";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const user = await requireUser();
  const [integrations, localClaude] = await Promise.all([listIntegrations(user.id), localClaudeStatus(user.id)]);
  const providers = INTEGRATION_PROVIDERS.map((p) => ({
    id: p.id,
    kind: p.kind,
    category: p.category,
    name: p.name,
    description: p.description,
    available: p.available,
    keyPlaceholder: p.keyPlaceholder,
    docsUrl: p.docsUrl,
    platformKey: platformKeyAvailable(p.id),
  }));
  return (
    <>
      <PageHeader title="Integrations" description="Connect the services your workflows use." />
      <IntegrationsView providers={providers} initial={integrations} localClaude={localClaude} />
    </>
  );
}
