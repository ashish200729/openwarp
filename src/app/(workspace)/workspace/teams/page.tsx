import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Network, Plus } from "lucide-react";
import { ButtonPixels, panelStyle, primaryButton, textButton } from "@/components/ui";
import { EmptyState, Notice, PageHeader } from "@/components/workspace/presentation";
import { TeamForm } from "@/components/workspace/record-forms";
import { listTeams } from "@/lib/server/directory";
import { requireMember } from "@/lib/server/member";
import { saveTeamAction } from "../actions";

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
      <Link href="/workspace/teams?edit=new" className={primaryButton}><ButtonPixels /> Create team <Plus aria-hidden="true" size={17} /></Link>} />
    {canManage && (saved === "created" || saved === "renamed") && <Notice>{saved === "created" ? "Team created." : "Team renamed."}</Notice>}
    {(adding || editing) && <TeamForm key={editing?.id ?? "new"} action={saveTeamAction} editing={editing} />}
    {teams.length ? <ul className="grid gap-3 sm:grid-cols-2 lg:gap-4 xl:grid-cols-3">
      {teams.map((team) => <li key={team.id} className={`${panelStyle} min-w-0 p-5`}>
        <span className="relative grid size-10 place-items-center rounded-lg border border-line bg-background text-accent"><Network aria-hidden="true" size={19} /><span aria-hidden="true" className="absolute -top-px -right-px size-1.5 bg-accent" /></span>
        <h2 className="mt-3 text-lg font-medium tracking-tight wrap-anywhere">{team.name}</h2>
        <p className="mt-1 font-mono text-xs text-muted">{team.people} {team.people === 1 ? "employee" : "employees"}</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-1.5 border-t border-line pt-2">
          <Link className="inline-flex min-h-11 items-center gap-1.5 rounded text-sm text-accent hover:underline" href={`/workspace/people?team=${team.id}`}>View people <ArrowRight aria-hidden="true" size={14} /></Link>
          {canManage && <Link className={textButton} href={`/workspace/teams?edit=${team.id}`} aria-label={`Rename ${team.name}`}>Rename</Link>}
        </div>
      </li>)}
    </ul> : !adding && <EmptyState title="No teams yet" description={canManage ? "Create a team, then assign employees from their profiles." : "Teams will appear here when an administrator creates them."} />}
  </>;
}
