import type { Metadata } from "next";
import Link from "next/link";
import { panelStyle, secondaryButton, textButton } from "@/components/ui";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { Empty, Notice, Section } from "@/components/workspace/presentation";
import { ProfileHeader } from "@/components/workspace/profile-header";
import { TimeOffList } from "@/components/workspace/requests";
import { BalanceFigures } from "@/components/workspace/time-leave";
import { formatDays, today } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import { employeeTimeOff, listAdjustments, timeOffBalances } from "@/lib/server/time-off";
import { decideTimeOffAction } from "../../../operations";
import { adjustBalanceAction } from "../../../time-off/actions";
import { privateProfile } from "../profile";

export const metadata: Metadata = { title: "Time off" };

export default async function ProfileTimeOffPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ adjust?: string; saved?: string }> }) {
  const { member, employee, canManage } = await privateProfile(params);
  const query = await searchParams;
  const day = today();
  const [balances, requests, adjustments] = await Promise.all([timeOffBalances(employee.id, Number(day.slice(0, 4))), employeeTimeOff(member, employee.id), listAdjustments(member, employee.id)]);
  const limited = balances.filter((balance) => balance.allowance !== null);
  const manages = canManage && employee.status !== "archived";
  const base = `/workspace/people/${employee.id}/time-off`;
  const adjusting = manages && query.adjust === "1" && limited.length > 0;
  return <>
    <ProfileHeader employee={employee} current="time-off" canSeePrivate actions={manages && <>
      {limited.length > 0 && !adjusting && <Link href={`${base}?adjust=1`} className={secondaryButton}>Adjust balance</Link>}
      <Link href={`/workspace/time-off?record=1&person=${employee.id}`} className={secondaryButton}>Enter time off</Link>
    </>} />
    {query.saved === "adjusted" && <Notice>Balance adjusted.</Notice>}
    {adjusting && <section className={`${panelStyle} mb-8 max-w-2xl p-5`}>
      <h2 className="mb-4 text-[15px] font-semibold">Adjust balance</h2>
      <ActionForm action={adjustBalanceAction} submit="Record adjustment" hidden={{ employeeId: employee.id }} secondary={<Link href={base} className={textButton}>Close</Link>}>
        <div className="grid gap-4 sm:grid-cols-3"><Field name="typeId" label="Type" required options={limited.map((balance) => ({ value: balance.typeId, label: balance.name }))} /><Field name="days" label="Days" required hint="Use a minus sign to take days away." /><Field name="effectiveOn" label="Effective date" type="date" required defaultValue={day} /></div>
        <Field name="reason" label="Reason" required maxLength={200} />
        <p className="text-[13px] text-muted">Adjustments can’t be edited or deleted. Correct one by adding another.</p>
      </ActionForm>
    </section>}
    <BalanceFigures balances={balances} />
    <Section title="Requests" className="mb-9">{requests.length ? <TimeOffList requests={requests} action={decideTimeOffAction} canCancel /> : <Empty>No requests yet.</Empty>}</Section>
    <Section title="Balance adjustments">{adjustments.length ? <ul className="divide-y divide-line">{adjustments.map((entry) => <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3 text-sm">
      <div className="min-w-0"><p className="font-medium">{entry.typeName}</p><p className="wrap-anywhere text-muted">{entry.reason}</p><p className="text-[13px] text-muted">{formatDate(entry.effectiveOn)}, {entry.createdBy}</p></div><span className="font-medium tabular-nums">{entry.days > 0 ? "+" : ""}{formatDays(entry.days)}</span>
    </li>)}</ul> : <Empty>No adjustments.</Empty>}</Section>
  </>;
}
