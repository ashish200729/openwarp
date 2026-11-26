import Link from "next/link";
import { CaretRightIcon } from "@/components/icons";
import { employmentLabels, formatDate } from "@/lib/people";
import type { Employee } from "@/lib/server/directory";
import { tableHead } from "@/components/ui";
import { Avatar, Status } from "./presentation";

export function PeopleList({ people }: { people: Employee[] }) {
  return <div>
    <ul className="divide-y divide-line xl:hidden">
      {people.map((person) => {
        const name = `${person.firstName} ${person.lastName}`;
        return <li key={person.id}>
          <Link href={`/workspace/people/${person.id}`} className="block py-3 focus-visible:outline-offset-[-2px]">
            <div className="flex items-start gap-3">
              <Avatar name={name} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium wrap-anywhere">{name}</p>
                <p className="mt-0.5 text-[13px] leading-snug wrap-anywhere text-muted">{person.title}</p>
              </div>
              <CaretRightIcon aria-hidden="true" size={16} className="mt-2 shrink-0 text-hint" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-11 text-[13px] text-muted"><Status status={person.status} /> <span className="wrap-anywhere">{person.teamName ?? "No team"} · {employmentLabels[person.employmentType]}</span></div>
          </Link>
        </li>;
      })}
    </ul>
    <table className="hidden w-full table-fixed text-left text-sm xl:table">
      <caption className="sr-only">Employee directory results</caption>
      <thead className={tableHead}>
        <tr><th scope="col" className="w-[34%] ">Employee</th><th scope="col" className="w-[20%] ">Team</th><th scope="col" className="w-[14%] ">Type</th><th scope="col" className="w-[16%] ">Status</th><th scope="col" className="w-[16%] ">Start date</th></tr>
      </thead>
      <tbody className="divide-y divide-line">
        {people.map((person) => {
          const name = `${person.firstName} ${person.lastName}`;
          return <tr key={person.id} className="hover:bg-background">
            <th scope="row" className="pr-4 font-normal">
              <Link href={`/workspace/people/${person.id}`} className="flex min-h-12 items-center gap-3 rounded py-1.5 hover:underline">
                <Avatar name={name} />
                <span className="min-w-0"><span className="block font-medium wrap-anywhere">{name}</span><span className="block text-[13px] wrap-anywhere text-muted">{person.title}</span></span>
              </Link>
            </th>
            <td className="py-2.5 pr-4 wrap-anywhere text-muted">{person.teamName ?? "No team"}</td>
            <td className="py-2.5 pr-4 text-muted">{employmentLabels[person.employmentType]}</td>
            <td className="py-2.5 pr-4"><Status status={person.status} /></td>
            <td className="py-2.5 pr-4 text-muted tabular-nums"><time dateTime={person.hireDate}>{formatDate(person.hireDate)}</time></td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}
