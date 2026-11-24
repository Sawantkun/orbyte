import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkflowStudio } from "@/components/studio/workflow-studio";
import { AppError } from "@/server/errors";
import { requireUser } from "@/server/session";
import { getWorkflow } from "@/server/workflows";

export const metadata: Metadata = { title: "Workflow Studio" };

export default async function WorkflowStudioPage({ params }: PageProps<"/workflows/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const workflow = await getWorkflow(user.id, id).catch((e: unknown) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  return <WorkflowStudio workflow={workflow} />;
}
