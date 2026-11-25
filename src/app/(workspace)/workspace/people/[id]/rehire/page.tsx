import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BackLink, PageHeader } from "@/components/workspace/presentation";
import { WorkflowDateForm } from "@/components/workspace/record-forms";
import { employeeProfile } from "@/lib/server/directory";
import { requireAdmin } from "@/lib/server/member";
import { rehireAction } from "../../../actions";

export const metadata: Metadata = { title: "Restart onboarding" };

export default async function RehireEmployee({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const profile = await employeeProfile(member, id);
  if (!profile || profile.employee.status !== "archived") notFound();
  const { employee } = profile;
  return <>
    <BackLink href={`/workspace/people/${id}`}>{employee.firstName} {employee.lastName}</BackLink>
    <PageHeader title="Restart onboarding" description="Keep the previous profile history and open a new checklist. You can assign a manager after restarting onboarding." />
    <WorkflowDateForm action={rehireAction} id={id} version={employee.version} kind="onboarding" minimum={employee.lastDay ?? "1900-01-01"} />
  </>;
}
