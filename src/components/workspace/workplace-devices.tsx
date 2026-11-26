import Link from "next/link";
import { CaretDownIcon } from "@/components/icons";
import { ActionButtons, ActionForm, Checkbox, Field } from "@/components/workspace/action-form";
import { StatusText, type Tone } from "@/components/workspace/workplace-parts";
import {
  attestationChecks, billingLabels, billings, conditionLabels, criticalities, criticalityLabels, deviceConditions, deviceKindLabels, deviceKinds, deviceStatusLabels, grantLabels, type DeviceStatus, type GrantState,
} from "@/lib/domains/workplace";
import { currencies } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import type { AppRow, Device, Grant, OwnDevice } from "@/lib/server/devices";
import { attestAction, confirmDeviceAction, grantCommandAction, reportRepairAction, saveAppAction, saveDeviceAction, sendBackAction } from "@/app/(workspace)/workspace/devices/actions";

const deviceTones: Record<DeviceStatus, Tone> = { in_stock: "positive", assigned: "accent", repair: "amber", retired: "muted", lost: "danger" };
const grantTones: Record<GrantState, Tone> = { requested: "amber", approved: "accent", granted: "positive", declined: "danger", withdrawn: "muted", revoked: "muted" };

export function DeviceState({ status }: { status: DeviceStatus }) {
  return <StatusText tone={deviceTones[status]}>{deviceStatusLabels[status]}</StatusText>;
}

export function GrantStatus({ state }: { state: GrantState }) {
  return <StatusText tone={grantTones[state]}>{grantLabels[state]}</StatusText>;
}

export function deviceName(device: { make: string; model: string }) {
  return [device.make, device.model].filter(Boolean).join(" ");
}

export function DeviceForm({ device, currency, cancel }: { device?: Device; currency: string; cancel: React.ReactNode }) {
  return <ActionForm action={saveDeviceAction} submit={device ? "Save device" : "Add device"} hidden={device ? { id: device.id, version: device.version } : {}} secondary={cancel}>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field name="assetTag" label="Asset tag" required maxLength={40} defaultValue={device?.assetTag} /><Field name="kind" label="Type" required defaultValue={device?.kind ?? "laptop"} options={deviceKinds.map((value) => ({ value, label: deviceKindLabels[value] }))} />
      <Field name="make" label="Make" maxLength={80} defaultValue={device?.make} /><Field name="model" label="Model" required maxLength={120} defaultValue={device?.model} />
      <Field name="serial" label="Serial number" maxLength={80} defaultValue={device?.serial} /><Field name="condition" label="Condition" required defaultValue={device?.condition ?? "good"} options={deviceConditions.map((value) => ({ value, label: conditionLabels[value] }))} />
      <Field name="purchasedOn" label="Purchase date" type="date" defaultValue={device?.purchasedOn ?? ""} /><Field name="warrantyEndsOn" label="Warranty ends" type="date" defaultValue={device?.warrantyEndsOn ?? ""} />
      <Field name="cost" label="Cost" inputMode="decimal" placeholder="0.00" defaultValue={device?.costCents == null ? "" : (device.costCents / 100).toFixed(2)} /><Field name="currency" label="Currency" required defaultValue={device?.currency ?? currency} options={currencies.map((value) => ({ value, label: value }))} />
    </div>
    <Field name="notes" label="Notes" multiline maxLength={1000} defaultValue={device?.notes} />
  </ActionForm>;
}

export function AppForm({ app, currency, people, cancel }: { app?: AppRow; currency: string; people: { id: string; name: string }[]; cancel?: React.ReactNode }) {
  return <ActionForm key={app?.version} action={saveAppAction} submit={app ? "Save app" : "Add app"} hidden={app ? { id: app.id, version: app.version } : {}} secondary={cancel}>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field name="name" label="Name" required maxLength={80} defaultValue={app?.name} /><Field name="ownerId" label="Owner" defaultValue={app?.ownerId ?? ""} options={[{ value: "", label: "No owner" }, ...people.map((person) => ({ value: person.id, label: person.name }))]} />
      <Field name="seatCost" label="Cost per seat" inputMode="decimal" placeholder="0.00" defaultValue={app ? (app.seatCostCents / 100).toFixed(2) : ""} /><Field name="billing" label="Billed" required defaultValue={app?.billing ?? "monthly"} options={billings.map((value) => ({ value, label: billingLabels[value][0].toUpperCase() + billingLabels[value].slice(1) }))} />
      <Field name="currency" label="Currency" required defaultValue={app?.currency ?? currency} options={currencies.map((value) => ({ value, label: value }))} /><Field name="seats" label="Seats bought" type="number" min={0} defaultValue={app?.seats ?? ""} />
      <Field name="renewsOn" label="Renewal date" type="date" defaultValue={app?.renewsOn ?? ""} /><Field name="criticality" label="Criticality" required defaultValue={app?.criticality ?? "normal"} hint="Access to a critical app must be removed before someone is archived." options={criticalities.map((value) => ({ value, label: criticalityLabels[value] }))} />
    </div>
    <Field name="notes" label="Notes" multiline maxLength={1000} defaultValue={app?.notes} />
  </ActionForm>;
}

export function OwnDevices({ devices }: { devices: OwnDevice[] }) {
  return <ul className="divide-y divide-line">{devices.map((device) => <li key={device.assignmentId} className="py-3 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-0"><p className="font-medium wrap-anywhere">{deviceName(device)} <span className="font-normal text-muted">· {deviceKindLabels[device.kind]} {device.assetTag}</span></p>
        <p className="text-[13px] text-muted">{device.receivedAt ? `Confirmed ${formatDate(device.receivedAt)}` : `Assigned ${formatDate(device.assignedAt)}`}{device.serial && `, serial ${device.serial}`}{device.openRepairs > 0 && `, ${device.openRepairs} open ${device.openRepairs === 1 ? "problem" : "problems"}`}</p>
        {device.sentBackAt ? <StatusText tone="muted">You sent this back. An administrator records the return.</StatusText> : device.returnDueOn && <StatusText tone="amber">Return by {formatDate(device.returnDueOn)}</StatusText>}</div>
      <div className="flex flex-wrap gap-2">
        {!device.receivedAt && !device.sentBackAt && <ActionButtons action={confirmDeviceAction} hidden={{ id: device.assignmentId }} name="operation" buttons={[{ value: "confirm", label: "I have this", describe: `I have this: ${device.assetTag}`, variant: "primary" }]} />}
        {device.returnDueOn && !device.sentBackAt && <ActionButtons action={sendBackAction} hidden={{ id: device.assignmentId }} name="operation" buttons={[{ value: "sent", label: "I’ve sent it back", describe: `I’ve sent it back: ${device.assetTag}`, confirm: { title: "Did you send it back?", body: "Administrators are told to expect it. You can’t undo this.", action: "Yes, I sent it" } }]} />}
      </div>
    </div>
    {device.receivedAt && !device.sentBackAt && device.kind !== "monitor" && device.kind !== "accessory" && device.kind !== "other" && <details className="group mt-1" open={device.attestDue}>
      <summary className="inline-flex min-h-10 items-center gap-1.5 rounded text-[13px] text-muted hover:text-foreground">{device.attestDue ? "Security check is due" : `Security check, next due ${formatDate(device.attestDueOn)}`}<CaretDownIcon aria-hidden="true" size={12} className="group-open:rotate-180" /></summary>
      <ActionForm key={device.attestDueOn} action={attestAction} submit="Send security check" hidden={{ assignmentId: device.assignmentId }} variant="secondary" className="max-w-xl pt-2 pb-2">
        <p className="text-[13px] text-muted">Check each setting on the device, then tick the ones that are on. Nothing is read from the device.</p>
        {attestationChecks.map((check) => <Checkbox key={check.key} name={check.key} label={check.label} />)}
      </ActionForm>
    </details>}
    {!device.sentBackAt && <details className="group">
      <summary className="inline-flex min-h-10 items-center gap-1.5 rounded text-[13px] text-muted hover:text-foreground">Report a problem<span className="sr-only"> with {device.assetTag}</span><CaretDownIcon aria-hidden="true" size={12} className="group-open:rotate-180" /></summary>
      <ActionForm action={reportRepairAction} submit="Report problem" hidden={{ deviceId: device.id }} variant="secondary" className="max-w-xl pt-2 pb-2"><Field name="issue" label="What is wrong?" required multiline maxLength={500} /></ActionForm>
    </details>}
  </li>)}</ul>;
}

export function GrantList({ grants, mode }: { grants: Grant[]; mode: "own" | "decide" | "app" }) {
  return <ul className="divide-y divide-line">{grants.map((grant) => {
    const what = mode === "own" ? grant.appName : `${grant.employeeName}’s ${grant.appName} access`;
    return <li key={grant.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm">
      <div className="min-w-0"><p className="font-medium wrap-anywhere">{mode === "own" ? grant.appName : <Link href={`/workspace/people/${grant.employeeId}`} className="hover:underline">{grant.employeeName}</Link>}{mode === "decide" && <span className="font-normal text-muted"> · {grant.appName}</span>}</p>
        <p className="text-[13px] wrap-anywhere text-muted">{grant.role}, {grant.state === "granted" && grant.grantedAt ? `since ${formatDate(grant.grantedAt)}` : grant.closedAt ? `closed ${formatDate(grant.closedAt)}` : `asked ${formatDate(grant.requestedAt)}`}{grant.reason && `. ${grant.reason}`}</p></div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><GrantStatus state={grant.state} />
        {mode === "own" && (grant.state === "requested" || grant.state === "approved") && <ActionButtons action={grantCommandAction} hidden={{ id: grant.id }} name="operation" buttons={[{ value: "withdrawn", label: "Withdraw", describe: `Withdraw ${what} request`, variant: "text", confirm: { title: "Withdraw this request?", body: "You can ask again later.", action: "Withdraw request", danger: true } }]} />}
        {mode === "decide" && grant.state === "requested" && <ActionButtons action={grantCommandAction} hidden={{ id: grant.id }} name="operation" buttons={[{ value: "approved", label: "Approve", describe: `Approve ${what}`, variant: "primary" }, { value: "declined", label: "Decline", describe: `Decline ${what}` }]} />}
        {mode !== "own" && grant.state === "approved" && <ActionButtons action={grantCommandAction} hidden={{ id: grant.id }} name="operation" buttons={[{ value: "granted", label: "Mark as granted", describe: `Mark as granted: ${what}`, variant: "primary" }, { value: "declined", label: "Decline", describe: `Decline ${what}` }]} />}
        {mode === "app" && grant.state === "granted" && <ActionButtons action={grantCommandAction} hidden={{ id: grant.id }} name="operation" buttons={[{ value: "revoked", label: "Mark as removed", describe: `Mark as removed: ${what}`, variant: "text", confirm: { title: `Record that ${what} was removed?`, body: "Remove the access in the app itself first. OpenWarp only keeps the record.", action: "Record removal", danger: true } }]} />}
        {mode === "app" && grant.state === "requested" && <ActionButtons action={grantCommandAction} hidden={{ id: grant.id }} name="operation" buttons={[{ value: "granted", label: "Mark as granted", describe: `Mark as granted: ${what}` }]} />}</div>
    </li>;
  })}</ul>;
}
