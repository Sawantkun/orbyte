import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExecutionDetailView } from "@/components/executions/execution-detail";
import { AppError } from "@/server/errors";
import { getExecution } from "@/server/executions";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Execution" };

export default async function ExecutionPage({ params }: PageProps<"/executions/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const execution = await getExecution(user.id, id).catch((e: unknown) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  return <ExecutionDetailView key={execution.id} initial={execution} />;
}
