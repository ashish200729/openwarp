import Link from "next/link";
import { textLink } from "@/components/ui";
import { formatMinutes, formatWeekday } from "@/lib/domains/time";
import type { Shift } from "@/lib/server/schedule";
import { cn } from "@/lib/utils";

const times = (shift: Shift) => `${shift.start} to ${shift.end}${shift.overnight ? " the next day" : ""}`;

function flags(shift: Shift) {
  return [
    !shift.published && { text: "Draft", color: "text-amber" },
    shift.away && { text: "On approved time off", color: "text-danger" },
    shift.attendance?.kind === "missed" && { text: "Missed", color: "text-danger" },
    shift.attendance?.kind === "absent" && { text: "Not clocked in", color: "text-danger" },
    shift.attendance?.kind === "late" && { text: `${formatMinutes(shift.attendance.minutes)} late`, color: "text-amber" },
  ].filter((flag) => flag !== false);
}

function ShiftText({ shift, editUrl, narrow }: { shift: Shift; editUrl: string; narrow?: boolean }) {
  return <div className="text-[13px] leading-snug">
    <span className="block tabular-nums">{shift.manages ? <Link href={editUrl} aria-label={`${times(shift)}, edit shift for ${shift.name} on ${formatWeekday(shift.day)}`} className={cn(textLink, "inline-flex min-h-6 items-center")}>{narrow ? <>{shift.start} to {shift.end}</> : times(shift)}</Link> : times(shift)}</span>
    {narrow && shift.overnight && shift.manages && <span className="block text-muted">the next day</span>}
    {shift.role && <span className="block wrap-anywhere">{shift.role}</span>}
    {shift.note && <span className="block wrap-anywhere text-muted">{shift.note}</span>}
    {flags(shift).map((flag) => <span key={flag.text} className={cn("block font-medium", flag.color)}>{flag.text}</span>)}
  </div>;
}

export function ShiftGrid({ shifts, days, today, editUrl, label }: { shifts: Shift[]; days: string[]; today: string; editUrl: (id: string) => string; label: string }) {
  const people = [...new Map(shifts.map((shift) => [shift.employeeId, shift.name]))];
  return <>
    <div className="mt-3 hidden overflow-x-auto lg:block" tabIndex={0} role="region" aria-label={label}><table className="w-full min-w-[56rem] table-fixed text-sm">
      <caption className="sr-only">{label}</caption>
      <thead><tr className="border-b border-line text-left text-[13px] text-muted"><th scope="col" className="w-36 py-2 pr-3 font-medium">Person</th>{days.map((day) => <th key={day} scope="col" className={cn("px-2 py-2 font-medium", day === today && "text-foreground")}>{formatWeekday(day)}</th>)}</tr></thead>
      <tbody className="divide-y divide-line">{people.map(([id, name]) => <tr key={id}><th scope="row" className="py-2.5 pr-3 text-left align-top font-medium wrap-anywhere">{name}</th>
        {days.map((day) => <td key={day} className={cn("px-2 py-2.5 align-top", day === today && "bg-background")}><div className="grid gap-2">{shifts.filter((shift) => shift.employeeId === id && shift.day === day).map((shift) => <ShiftText key={shift.id} shift={shift} editUrl={editUrl(shift.id)} narrow />)}</div></td>)}</tr>)}</tbody>
    </table></div>
    <ul className="divide-y divide-line lg:hidden">{days.filter((day) => shifts.some((shift) => shift.day === day)).map((day) => <li key={day} className="py-3">
      <p className={cn("text-sm font-medium", day === today && "text-accent")}>{formatWeekday(day)}</p>
      <ul className="mt-1 grid gap-2.5">{shifts.filter((shift) => shift.day === day).map((shift) => <li key={shift.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3"><span className="text-sm wrap-anywhere">{shift.name}</span><ShiftText shift={shift} editUrl={editUrl(shift.id)} /></li>)}</ul>
    </li>)}</ul>
  </>;
}
