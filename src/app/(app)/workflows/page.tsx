import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { WorkflowList } from "@/components/workflows/workflow-list";
import { listWorkflowsQuery } from "@/lib/validation/workflow";
import { requireUser } from "@/server/session";
import { listWorkflows } from "@/server/workflows";

export const metadata: Metadata = { title: "Workflows" };

export default async function WorkflowsPage({ searchParams }: PageProps<"/workflows">) {
  const user = await requireUser();
  const { q } = await searchParams;
  const query = listWorkflowsQuery.parse({ q: typeof q === "string" ? q : undefined, limit: 24 });
  const { items, nextCursor } = await listWorkflows(user.id, query);

  return (
    <>
      <PageHeader
        title="Workflows"
        description="Design AI workflows visually, then publish versions to run them."
        actions={
          <Button asChild>
            <Link href="/workflows/new">
              <Plus /> New workflow
            </Link>
          </Button>
        }
      />
      <WorkflowList initial={items} initialCursor={nextCursor} query={query.q ?? ""} />
    </>
  );
}
