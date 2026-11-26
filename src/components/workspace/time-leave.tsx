import Link from "next/link";
import { panelStyle, textButton } from "@/components/ui";
import { ActionButtons, ActionForm, Checkbox, Field, type FormAction } from "@/components/workspace/action-form";
import { Avatar, Figure, FigureRow } from "@/components/workspace/presentation";
import { dateRange } from "@/components/workspace/requests";
import { formatDays } from "@/lib/operations";
import type { Schedulable } from "@/lib/server/schedule";
import type { TimeOffType } from "@/lib/server/settings";
import type { Balance, Coverage, TimeOffRequest } from "@/lib/server/time-off";

const round = (days: number) => Math.round(days * 100) / 100;

export function BalanceFigures({ balances }: { balances: Balance[] }) {
  if (!balances.length) return null;
  return <FigureRow>{balances.map((balance) => <Figure key={balance.typeId} label={balance.name} value={formatDays(balance.allowance === null ? balance.used : round(balance.allowance - balance.used - balance.pending))}
    detail={balance.allowance === null ? "taken this year" : `left of ${balance.allowance}${balance.pending ? `, ${formatDays(balance.pending)} pending` : ""}${balance.booked ? `, ${formatDays(balance.booked)} booked ahead` : ""}`} />)}</FigureRow>;
}

function coverageText({ teamName, people, away }: Coverage) {
  const others = `${people} ${people === 1 ? "other" : "others"} ${teamName ? `on ${teamName}` : "with the same manager"}`;
  if (!away.length) return `None of ${others} away`;
  return `${away.length} of ${others} away: ${away.slice(0, 3).join(", ")}${away.length > 3 ? ` and ${away.length - 3} more` : ""}`;
}

export function LeaveApprovals({ requests, coverage, action }: { requests: TimeOffRequest[]; coverage: Map<string, Coverage>; action: FormAction }) {
  return <ul className="divide-y divide-line">
    {requests.map((request) => {
      const what = `${request.employeeName}’s ${request.typeName}`;
      const team = coverage.get(request.id);
      return <li key={request.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3">
        <div className="flex min-w-0 items-start gap-3"><Avatar name={request.employeeName} />
          <div className="min-w-0 text-sm"><p><Link href={`/workspace/people/${request.employeeId}`} className="font-medium hover:underline">{request.employeeName}</Link> <span className="text-muted">· {request.typeName}</span></p>
            <p className="text-muted">{dateRange(request.startsOn, request.endsOn)}, {request.halfDay ? "half day" : formatDays(request.days)}</p>
            {team && <p className={team.away.length ? "text-amber" : "text-muted"}>{coverageText(team)}</p>}
            {request.note && <p className="mt-1 max-w-[60ch] wrap-anywhere">{request.note}</p>}</div></div>
        <ActionButtons action={action} hidden={{ id: request.id }} name="decision" buttons={[{ value: "approved", label: "Approve", describe: `Approve ${what}`, variant: "primary" }, { value: "declined", label: "Decline", describe: `Decline ${what}` }]} />
      </li>;
    })}
  </ul>;
}

export function RecordTimeOffForm({ action, people, types, person, day }: { action: FormAction; people: Schedulable[]; types: TimeOffType[]; person?: string; day: string }) {
  return <section className={`${panelStyle} mb-8 max-w-2xl p-5`}>
    <h2 className="mb-4 text-[15px] font-semibold">Enter time off for someone</h2>
    <ActionForm action={action} submit="Enter time off" secondary={<Link href="/workspace/time-off" className={textButton}>Close</Link>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="employeeId" label="Person" required defaultValue={people.some((entry) => entry.id === person) ? person : undefined} options={people.map((entry) => ({ value: entry.id, label: entry.name }))} /><Field name="typeId" label="Type" required options={types.map((type) => ({ value: type.id, label: type.name }))} />
        <Field name="startsOn" label="First day" type="date" required defaultValue={day} /><Field name="endsOn" label="Last day off" type="date" required defaultValue={day} />
      </div>
      <Checkbox name="halfDay" label="Half day" hint="For a single date." />
      <Checkbox name="overBalance" label="Allow this to go over the balance" />
      <Field name="note" label="Note" multiline maxLength={500} />
      <p className="text-[13px] text-muted">It is approved straight away and the person is notified. Notice and waiting periods don’t apply.</p>
    </ActionForm>
  </section>;
}
