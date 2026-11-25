import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EmployeeForm } from "@/components/workspace/employee-form";
import { BackLink, PageHeader } from "@/components/workspace/presentation";
import { employeeProfile, listManagerOptions, listTeams } from "@/lib/server/directory";
import { requireAdmin } from "@/lib/server/member";
import { saveEmployeeAction } from "../../../actions";

export const metadata: Metadata = { title: "Edit profile" };

export default async function EditEmployee({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const profile = await employeeProfile(member, id);
  if (!profile || profile.employee.status === "archived") notFound();
  const { employee } = profile;
  const [teams, managers] = await Promise.all([listTeams(member), listManagerOptions(employee)]);
  return <>
    <BackLink href={`/workspace/people/${id}`}>{employee.firstName} {employee.lastName}</BackLink>
    <PageHeader title="Edit profile" description="Update the employee’s work details or reporting line." />
    <EmployeeForm action={saveEmployeeAction.bind(null, "edit")} profile={{ id, version: employee.version }} teams={teams} managers={managers}
      initial={{ ...employee, teamId: employee.teamId ?? "", managerId: employee.managerId ?? "", lastDay: employee.lastDay ?? "" }} />
  </>;
}
