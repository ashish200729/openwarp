import type { Metadata } from "next";
import { EmployeeForm } from "@/components/workspace/employee-form";
import { BackLink, PageHeader } from "@/components/workspace/presentation";
import { listManagerOptions, listTeams } from "@/lib/server/directory";
import { requireAdmin } from "@/lib/server/member";
import { saveEmployeeAction } from "../../actions";

export const metadata: Metadata = { title: "Add employee" };

export default async function NewEmployee() {
  const member = await requireAdmin();
  const [teams, managers] = await Promise.all([listTeams(member), listManagerOptions()]);
  return <>
    <BackLink href="/workspace/people">People directory</BackLink>
    <PageHeader title="Add employee" description="Create a work profile and decide whether onboarding is needed." />
    <EmployeeForm action={saveEmployeeAction.bind(null, "create")} teams={teams} managers={managers} />
  </>;
}
