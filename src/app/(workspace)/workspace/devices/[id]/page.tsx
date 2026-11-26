import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PencilSimpleIcon } from "@/components/icons";
import { panelStyle, secondaryButton, textButton } from "@/components/ui";
import { ActionButtons, ActionForm, Field } from "@/components/workspace/action-form";
import { BackLink, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { DeviceForm, deviceName, DeviceState } from "@/components/workspace/workplace-devices";
import { DataTable, Details, StatusText } from "@/components/workspace/workplace-parts";
import { attestationChecks, conditionLabels, deviceConditions, deviceKindLabels, deviceStatusLabels } from "@/lib/domains/workplace";
import { addDays, formatMoney, today } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import { readDevice } from "@/lib/server/devices";
import { requireAdmin } from "@/lib/server/member";
import { assignTargets } from "@/lib/server/training";
import { askForReturnAction, assignDeviceAction, closeRepairAction, deviceStatusAction, reportRepairAction, returnDeviceAction } from "../actions";

export const metadata: Metadata = { title: "Device" };

export default async function DevicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; saved?: string }> }) {
  await requireAdmin();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const result = await readDevice(id);
  if (!result) notFound();
  const { device, assignments, repairs, attestations } = result;
  const people = device.status === "in_stock" ? await assignTargets() : [];
  const money = (cents: number | null, currency: string) => cents === null ? "Not recorded" : formatMoney(cents, currency);
  const statusButtons = (["in_stock", "repair", "retired", "lost"] as const).filter((status) => status !== device.status);
  return <>
    <BackLink href="/workspace/devices">Devices</BackLink>
    <PageHeader title={device.assetTag} description={deviceName(device)} actions={query.edit !== "1" && <Link href={`/workspace/devices/${id}?edit=1`} className={secondaryButton}><PencilSimpleIcon aria-hidden="true" size={15} /> Edit device</Link>} />
    {query.saved === "added" && <Notice>Device added.</Notice>}
    {query.saved === "changed" && <Notice>Device saved.</Notice>}
    {query.edit === "1" ? <section className={`${panelStyle} mb-8 max-w-3xl p-5`}><h2 className="mb-4 text-[15px] font-semibold">Edit device</h2><DeviceForm key={device.version} device={device} currency={device.currency} cancel={<Link href={`/workspace/devices/${id}`} className={textButton}>Close</Link>} /></section>
      : <Section title="Details" className="mb-9"><Details items={[["Status", <DeviceState key="status" status={device.status} />], ["Type", deviceKindLabels[device.kind]], ["Condition", conditionLabels[device.condition]], ["Serial number", device.serial || "Not recorded"], ["Purchased", device.purchasedOn ? formatDate(device.purchasedOn) : "Not recorded"], ["Cost", money(device.costCents, device.currency)], ["Warranty ends", device.warrantyEndsOn ? formatDate(device.warrantyEndsOn) : "Not recorded"], ...(device.notes ? [["Notes", device.notes] as [string, string]] : [])]} /></Section>}
    <div className="grid gap-x-12 gap-y-9 lg:grid-cols-2">
      <div className="grid content-start gap-9">
        {device.holder ? <Section title={`With ${device.holder}`}>
          <p className="py-3 text-sm text-muted">{device.received ? "Confirmed as received." : "Not confirmed as received yet."}{device.sentBack ? " They say it was sent back." : device.returnDueOn ? ` Return due ${formatDate(device.returnDueOn)}.` : ""}</p>
          <ActionForm key={`return-${device.version}`} action={returnDeviceAction} submit="Record return" hidden={{ id, version: device.version }} confirm={{ title: `Record the return of ${device.assetTag}?`, body: "The assignment is closed and can’t be changed afterwards.", action: "Record device return" }}>
            <div className="grid gap-4 sm:grid-cols-2"><Field name="condition" label="Returned condition" required defaultValue={device.condition} options={[...deviceConditions, "lost" as const].map((value) => ({ value, label: conditionLabels[value] }))} /><Field name="next" label="Then" required options={[{ value: "in_stock", label: "Back in stock" }, { value: "repair", label: "Needs repair" }, { value: "retired", label: "Retire it" }]} /></div>
            <Field name="note" label="Return note" maxLength={500} />
          </ActionForm>
          {!device.sentBack && <ActionForm key={`ask-${device.returnDueOn}`} action={askForReturnAction} submit="Ask for it back" variant="secondary" hidden={{ id }} inline className="mt-6 border-t border-line pt-4"><Field name="dueOn" label="Return by" type="date" required defaultValue={device.returnDueOn ?? addDays(today(), 7)} wrapperClass="w-full sm:w-44" /></ActionForm>}
        </Section> : <Section title={device.status === "in_stock" ? "Assign" : "Status"}>
          {device.status === "in_stock" && <div className="pt-3 pb-5">{people.length ? <ActionForm action={assignDeviceAction} submit="Assign device" hidden={{ id, version: device.version }} inline><Field name="employeeId" label="Person" required options={[{ value: "", label: "Choose a person" }, ...people.map((person) => ({ value: person.id, label: person.name }))]} wrapperClass="w-full sm:w-64" /></ActionForm> : <Empty>Add someone to the directory first.</Empty>}</div>}
          <div className="py-3"><ActionButtons action={deviceStatusAction} hidden={{ id, version: device.version }} name="status" buttons={statusButtons.map((value) => ({ value, label: deviceStatusLabels[value], describe: `${deviceStatusLabels[value]}: set status of ${device.assetTag}`, confirm: value === "retired" || value === "lost" ? { title: `Mark ${device.assetTag} as ${deviceStatusLabels[value].toLowerCase()}?`, body: "It can’t be assigned until it is back in stock.", action: `Mark as ${deviceStatusLabels[value].toLowerCase()}`, danger: true } : undefined }))} /></div>
        </Section>}
        <Section title="Repairs">
          {repairs.length ? <ul className="divide-y divide-line">{repairs.map((repair) => <li key={repair.id} className="py-3 text-sm">
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><p className="min-w-0 wrap-anywhere">{repair.issue}</p><StatusText tone={repair.closedOn ? "muted" : "amber"}>{repair.closedOn ? "Closed" : "Open"}</StatusText></div>
            <p className="mt-0.5 text-[13px] wrap-anywhere text-muted">Reported by {repair.reportedBy} on {formatDate(repair.reportedOn)}{repair.closedOn && `. ${repair.outcome}. ${[repair.vendor, repair.costCents === null ? "" : formatMoney(repair.costCents, repair.currency), `closed ${formatDate(repair.closedOn)}`].filter(Boolean).join(", ")}`}</p>
            {!repair.closedOn && <ActionForm action={closeRepairAction} submit="Close repair" hidden={{ id: repair.id }} variant="secondary" className="pt-3"><Field name="outcome" label="What was done" required maxLength={500} /><div className="grid gap-4 sm:grid-cols-2"><Field name="vendor" label="Repaired by" maxLength={120} /><Field name="cost" label={`Cost in ${repair.currency}`} inputMode="decimal" placeholder="0.00" /></div></ActionForm>}
          </li>)}</ul> : <Empty>No problems reported.</Empty>}
          <ActionForm action={reportRepairAction} submit="Report problem" variant="secondary" hidden={{ deviceId: id }} inline className="border-t border-line pt-4"><Field name="issue" label="New problem" required maxLength={500} wrapperClass="w-full sm:w-72" /></ActionForm>
        </Section>
      </div>
      <div className="grid content-start gap-9">
        <Section title="Assignment history">{assignments.length ? <ol className="divide-y divide-line">{assignments.map((assignment) => <li key={assignment.id} className="py-3 text-sm"><p><Link href={`/workspace/people/${assignment.employeeId}`} className="font-medium hover:underline">{assignment.employeeName}</Link></p><p className="text-[13px] wrap-anywhere text-muted">{formatDate(assignment.assignedAt)} to {assignment.returnedAt ? formatDate(assignment.returnedAt) : "now"}{assignment.returnCondition && `, returned as ${conditionLabels[assignment.returnCondition].toLowerCase()}`}{assignment.returnNote && `. ${assignment.returnNote}`}</p></li>)}</ol> : <Empty>Never assigned.</Empty>}</Section>
        <Section title="Security checks"><p className="pt-2 text-[13px] text-muted">Reported by the person who has the device. Nothing is read from the device itself.</p><DataTable caption="Security checks" empty="No security checks yet." columns={["Date", "Person", "Not met"]} rows={attestations.map((entry) => {
          const gaps = attestationChecks.filter((check) => !entry[check.key]).map((check) => check.label);
          return [formatDate(entry.at), entry.employeeName, gaps.length ? <span key="gaps" className="text-danger">{gaps.join(", ")}</span> : <span key="none" className="text-positive">None</span>];
        })} /></Section>
      </div>
    </div>
  </>;
}
