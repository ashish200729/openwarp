import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CaretRightIcon } from "@/components/icons";
import { Avatar, EmptyState, PageHeader, Pagination } from "@/components/workspace/presentation";
import { orgLevel, readOrg, type OrgPerson } from "@/lib/server/insights";
import { requireMember } from "@/lib/server/member";

export const metadata: Metadata = { title: "Org chart" };

type Node = OrgPerson & { reports: Node[]; total: number };

function buildTree(people: OrgPerson[]) {
  const nodes = new Map<string, Node>(people.map((person) => [person.id, { ...person, reports: [], total: 0 }]));
  const roots: Node[] = [];
  for (const node of nodes.values()) {
    const manager = node.managerId ? nodes.get(node.managerId) : undefined;
    (manager ? manager.reports : roots).push(node);
  }
  const size = (node: Node): number => (node.total = node.reports.reduce((sum, report) => sum + 1 + size(report), 0));
  roots.forEach(size);
  return { leaders: roots.filter((node) => node.reports.length).sort((first, second) => second.total - first.total), unplaced: roots.filter((node) => !node.reports.length) };
}

function Person({ node }: { node: OrgPerson }) {
  return <Link href={`/workspace/people/${node.id}`} className="group flex min-w-0 items-center gap-2.5 rounded-[7px] py-1 pr-2">
    <Avatar name={node.name} />
    <span className="min-w-0 text-sm leading-snug"><span className="block font-medium wrap-anywhere group-hover:underline">{node.name}</span><span className="block text-[13px] wrap-anywhere text-muted">{node.title}{node.teamName && ` · ${node.teamName}`}</span></span>
  </Link>;
}

function Branch({ nodes, depth = 0 }: { nodes: Node[]; depth?: number }) {
  return <ul className={depth ? "ml-[15px] border-l border-line-strong pl-3 sm:pl-5" : ""}>
    {nodes.map((node) => <li key={node.id} className="relative py-0.5 before:absolute before:top-6 before:-left-3 before:hidden before:w-3 before:border-t before:border-line-strong sm:before:-left-5 sm:before:w-5 data-nested:before:block" data-nested={depth ? "" : undefined}>
      <div className={node.reports.length ? "pr-16" : ""}><Person node={node} /></div>
      {node.reports.length > 0 && <details open={depth < 3} className="group/branch">
        <summary className="absolute top-1.5 right-0 inline-flex min-h-9 items-center gap-1.5 rounded-[7px] px-2.5 text-[13px] text-muted tabular-nums hover:bg-raised hover:text-foreground">{node.total}<span className="sr-only"> {node.total === 1 ? "person reports" : "people report"} to {node.name}</span><CaretRightIcon aria-hidden="true" size={12} className="group-open/branch:rotate-90" /></summary>
        <Branch nodes={node.reports} depth={depth + 1} />
      </details>}
    </li>)}
  </ul>;
}

export default async function OrgPage({ searchParams }: { searchParams: Promise<{ manager?: string; page?: string }> }) {
  const member = await requireMember();
  const query = await searchParams;
  if (query.manager && !z.uuid().safeParse(query.manager).success) notFound();
  const people = query.manager || query.page ? null : await readOrg(member);
  if (!people || people.length > 2000) {
    const requested = typeof query.page === "string" && /^[1-9]\d{0,7}$/.test(query.page) ? Number(query.page) : 1;
    const level = await orgLevel(member, query.manager ?? null, requested);
    if (!level) notFound();
    const base = query.manager ? `/workspace/org?manager=${query.manager}&page=` : "/workspace/org?page=";
    return <>
      <PageHeader title="Org chart" description={level.manager ? `Direct reports to ${level.manager.name}.` : "Start with a person who has no visible manager and follow their direct reports."}
        actions={level.manager && <Link className="text-sm text-accent underline" href="/workspace/org">Top level</Link>} />
      <ul className="max-w-3xl divide-y divide-line">{level.people.map(person => <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 py-2"><Person node={person} />
        {person.reports > 0 && <Link className="inline-flex min-h-10 items-center rounded text-sm text-accent hover:underline" href={`/workspace/org?manager=${person.id}`}>{person.reports} direct {person.reports === 1 ? "report" : "reports"}<span className="sr-only"> to {person.name}</span></Link>}
      </li>)}</ul>
      {!level.people.length && <p className="text-sm text-muted">No direct reports to show.</p>}
      <Pagination page={level.page} pages={level.pages} url={page => base + page} />
    </>;
  }
  const { leaders, unplaced } = buildTree(people);
  return <>
    <PageHeader title="Org chart" description="Each number counts everyone below that person." />
    {leaders.length ? <div className="max-w-3xl"><Branch nodes={leaders} /></div> : <EmptyState title="No reporting lines yet" description="Set a manager on someone’s profile and the chart will build itself." />}
    {unplaced.length > 0 && <section className="mt-10"><h2 className="mb-3 border-b border-line pb-2 text-[15px] font-semibold">No manager or reports</h2><div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{unplaced.map((node) => <Person key={node.id} node={node} />)}</div></section>}
  </>;
}
