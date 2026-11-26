import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "@/components/icons";
import { primaryButton, textButton } from "@/components/ui";
import { EmptyState, Notice, PageHeader } from "@/components/workspace/presentation";
import { TeamForm } from "@/components/workspace/record-forms";
import { listTeams } from "@/lib/server/directory";
import { requireMember } from "@/lib/server/member";
import { archiveTeamAction, saveTeamAction } from "../actions";
import { ActionButtons } from "@/components/workspace/action-form";

export const metadata: Metadata = { title: "Teams" };

export default async function TeamsPage({ searchParams }: { searchParams: Promise<{ edit?: string; saved?: string }> }) {
  const member = await requireMember();
  const { edit, saved } = await searchParams;
  const canManage = member.role === "admin";
  const teams = await listTeams(member);
  const editing = canManage ? teams.find((team) => team.id === edit) : undefined;
  const adding = canManage && edit === "new";

  return <>
    <PageHeader title="Teams" description="Organize the directory around the groups people work in." actions={canManage && !adding && !editing &&
      <Link href="/workspace/teams?edit=new" className={primaryButton}><PlusIcon aria-hidden="true" size={15} weight="bold" /> Create team</Link>} />
    {canManage && (saved === "created" || saved === "renamed") && <Notice>{saved === "created" ? "Team created." : "Team renamed."}</Notice>}
    {(adding || editing) && <TeamForm key={editing?.id ?? "new"} action={saveTeamAction} editing={editing} />}
    {teams.length ? <ul className="divide-y divide-line border-y border-line">
      {teams.map((team) => <li key={team.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2">
        <div className="min-w-0"><h2 className="text-sm font-medium wrap-anywhere">{team.name}</h2><p className="text-[13px] text-muted tabular-nums">{team.people} {team.people === 1 ? "person" : "people"}</p></div>
        <div className="flex items-center gap-1"><Link className={textButton} href={`/workspace/people?team=${team.id}`}>View people</Link>
          {canManage && <Link className={textButton} href={`/workspace/teams?edit=${team.id}`} aria-label={`Rename ${team.name}`}>Rename</Link>}
          {canManage && team.people === 0 && <ActionButtons action={archiveTeamAction} hidden={{ id: team.id }} name="operation" buttons={[{ value: "archive", label: "Archive", describe: `Archive ${team.name}`, variant: "text", confirm: { title: `Archive ${team.name}?`, body: "It leaves team lists and filters. Job history keeps its name.", action: "Archive team", danger: true } }]} />}</div>
      </li>)}
    </ul> : !adding && <EmptyState title="No teams yet" description={canManage ? "Create a team, then assign employees from their profiles." : "Teams will appear here when an administrator creates them."} />}
  </>;
}
