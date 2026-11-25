import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { employmentLabels, formatDate } from "@/lib/people";
import type { Employee } from "@/lib/server/directory";
import { panelStyle } from "@/components/ui";
import { Avatar, Status } from "./presentation";

export function PeopleList({ people }: { people: Employee[] }) {
  return <div className={`${panelStyle} overflow-hidden`}>
    <ul className="divide-y divide-line xl:hidden">
      {people.map((person) => {
        const name = `${person.firstName} ${person.lastName}`;
        return <li key={person.id}>
          <Link href={`/workspace/people/${person.id}`} className="block p-3.5 hover:bg-raised focus-visible:outline-offset-[-3px] sm:p-4">
            <div className="flex items-start gap-3">
              <Avatar name={name} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium wrap-anywhere">{name}</p>
                <p className="mt-0.5 text-xs leading-relaxed wrap-anywhere text-muted">{person.title}</p>
              </div>
              <ChevronRight aria-hidden="true" size={16} className="mt-2 shrink-0 text-hint" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-12 text-xs text-muted"><Status status={person.status} /> <span className="wrap-anywhere">{person.teamName ?? "No team"} · {employmentLabels[person.employmentType]}</span></div>
          </Link>
        </li>;
      })}
    </ul>
    <table className="hidden w-full table-fixed text-left text-sm xl:table">
      <caption className="sr-only">Employee directory results</caption>
      <thead className="border-b border-line bg-background/45 font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
        <tr><th scope="col" className="w-[32%] px-4 py-3 font-medium">Employee</th><th scope="col" className="w-[21%] px-3 py-3 font-medium">Team</th><th scope="col" className="w-[15%] px-3 py-3 font-medium">Type</th><th scope="col" className="w-[16%] px-3 py-3 font-medium">Status</th><th scope="col" className="w-[16%] px-3 py-3 font-medium">Start date</th></tr>
      </thead>
      <tbody className="divide-y divide-line">
        {people.map((person) => {
          const name = `${person.firstName} ${person.lastName}`;
          return <tr key={person.id} className="hover:bg-raised/60">
            <th scope="row" className="px-4 py-1.5 font-normal">
              <Link href={`/workspace/people/${person.id}`} className="flex min-h-12 items-center gap-3 rounded py-1.5 hover:text-accent">
                <Avatar name={name} />
                <span className="min-w-0"><span className="block font-medium wrap-anywhere">{name}</span><span className="block text-xs wrap-anywhere text-muted">{person.title}</span></span>
              </Link>
            </th>
            <td className="px-3 py-3 wrap-anywhere text-muted">{person.teamName ?? "No team"}</td>
            <td className="px-3 py-3 text-muted">{employmentLabels[person.employmentType]}</td>
            <td className="px-3 py-3"><Status status={person.status} /></td>
            <td className="px-3 py-3 font-mono text-xs text-muted"><time dateTime={person.hireDate}>{formatDate(person.hireDate)}</time></td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}
