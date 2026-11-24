import type { Metadata } from "next";
import { IntegrationsView } from "@/components/integrations/integrations-view";
import { PageHeader } from "@/components/layout/page-header";
import { INTEGRATION_PROVIDERS } from "@/config/integrations";
import { listIntegrations, platformKeyAvailable } from "@/server/integrations";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const user = await requireUser();
  const integrations = await listIntegrations(user.id);
  const providers = INTEGRATION_PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    available: p.available,
    keyPlaceholder: p.keyPlaceholder,
    docsUrl: p.docsUrl,
    platformKey: platformKeyAvailable(p.id),
  }));
  return (
    <>
      <PageHeader title="Integrations" description="Connect your own AI provider keys. Workflows use your key first." />
      <IntegrationsView providers={providers} initial={integrations} />
    </>
  );
}
