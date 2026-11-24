import type { Metadata } from "next";
import { ExecutionList } from "@/components/executions/execution-list";
import { PageHeader } from "@/components/layout/page-header";
import { listExecutionsQuery } from "@/lib/validation/workflow";
import { listExecutions } from "@/server/executions";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Executions" };

export default async function ExecutionsPage({ searchParams }: PageProps<"/executions">) {
  const user = await requireUser();
  const { status } = await searchParams;
  const parsed = listExecutionsQuery.safeParse({ status: typeof status === "string" ? status : undefined });
  const query = parsed.success ? parsed.data : listExecutionsQuery.parse({});
  const { items, nextCursor } = await listExecutions(user.id, query);
  return (
    <>
      <PageHeader title="Executions" description="Every workflow run, with per-node inputs, outputs and logs." />
      <ExecutionList initial={items} initialCursor={nextCursor} status={query.status ?? ""} />
    </>
  );
}
