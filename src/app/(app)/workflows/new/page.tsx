import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { NewWorkflowForm } from "@/components/workflows/new-workflow-form";

export const metadata: Metadata = { title: "New workflow" };

export default function NewWorkflowPage() {
  return (
    <>
      <PageHeader title="New workflow" description="Name it and pick a starting point. You can change everything in the Studio." />
      <NewWorkflowForm />
    </>
  );
}
