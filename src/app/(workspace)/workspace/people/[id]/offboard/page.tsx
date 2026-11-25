import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BackLink, PageHeader } from "@/components/workspace/presentation";
import { WorkflowDateForm } from "@/components/workspace/record-forms";
import { employeeProfile } from "@/lib/server/directory";
import { requireAdmin } from "@/lib/server/member";
import { offboardAction } from "../../../actions";

export const metadata: Metadata = { title: "Start offboarding" };

export default async function OffboardEmployee({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const profile = await employeeProfile(member, id);
  if (!profile || profile.employee.status !== "active") notFound();
  const { employee } = profile;
  return <>
    <BackLink href={`/workspace/people/${id}`}>{employee.firstName} {employee.lastName}</BackLink>
    <PageHeader title="Start offboarding" description="Set a last day to open a departure checklist. You’ll archive the profile after completing the tasks and reassigning any direct reports." />
    <WorkflowDateForm action={offboardAction} id={id} version={employee.version} kind="offboarding" minimum={employee.hireDate} />
  </>;
}
