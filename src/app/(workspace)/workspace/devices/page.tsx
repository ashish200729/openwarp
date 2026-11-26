import type { Metadata } from "next";
import Link from "next/link";
import { DownloadSimpleIcon, PlusIcon, UploadSimpleIcon } from "@/components/icons";
import { panelStyle, primaryButton, secondaryButton, textButton, textLink } from "@/components/ui";
import { ActionButtons, ActionForm, Field } from "@/components/workspace/action-form";
import { Callout, Empty, EmptyState, Figure, FigureRow, Notice, PageHeader, Pagination, Section } from "@/components/workspace/presentation";
import { DeviceForm, deviceName, DeviceState, OwnDevices } from "@/components/workspace/workplace-devices";
import { DataTable, Filters } from "@/components/workspace/workplace-parts";
import { deviceKindLabels, deviceKinds, deviceStatuses, deviceStatusLabels } from "@/lib/domains/workplace";
import { formatDate } from "@/lib/people";
import { canRequestEquipment, deviceFilters, deviceSummary, listDevices, openDeviceRequests, ownDeviceRequests, ownDevices, pendingGrants, type DeviceFilters } from "@/lib/server/devices";
import { requireMember, type Member } from "@/lib/server/member";
import { readCompany } from "@/lib/server/settings";
import { deviceRequestAction, requestDeviceAction } from "./actions";
import { DevicesNav } from "./nav";

export const metadata: Metadata = { title: "Devices and apps" };

const requestStates = { open: "Waiting", fulfilled: "Assigned", declined: "Declined", cancelled: "Cancelled" } as const;

function listUrl(filters: DeviceFilters, path = "/workspace/devices") {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.status) params.set("status", filters.status);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

async function Inventory({ filters, adding }: { filters: DeviceFilters; adding: boolean }) {
  const [{ devices, total, page, pages }, counts, company] = await Promise.all([listDevices(filters), deviceSummary(), readCompany()]);
  const filtered = Boolean(filters.query || filters.status || filters.kind);
  return <>
    {adding && <section className={`${panelStyle} mb-8 max-w-3xl p-5`}><h2 className="mb-4 text-[15px] font-semibold">Add a device</h2><DeviceForm currency={company.currency} cancel={<Link href="/workspace/devices" className={textButton}>Close</Link>} /></section>}
    <FigureRow>{deviceStatuses.map((status) => <Figure key={status} label={deviceStatusLabels[status]} value={counts.get(status) ?? 0} href={`/workspace/devices?status=${status}`} />)}</FigureRow>
    <Section title="Inventory" className="mb-9">
      <div className="pt-3"><Filters label="Filter devices" action="/workspace/devices" clear={filtered && "/workspace/devices"} fields={[
        { name: "q", label: "Search devices", value: filters.query, type: "search" },
        { name: "status", label: "Status", value: filters.status, options: [{ value: "", label: "Any status" }, ...deviceStatuses.map((value) => ({ value, label: deviceStatusLabels[value] }))] },
        { name: "kind", label: "Type", value: filters.kind, options: [{ value: "", label: "Any type" }, ...deviceKinds.map((value) => ({ value, label: deviceKindLabels[value] }))] },
      ]} /></div>
      <p className="mb-1 text-[13px] text-muted tabular-nums">{total} {total === 1 ? "device" : "devices"}</p>
      {devices.length ? <>
        <DataTable caption="Devices" columns={["Device", "Type", "Status", "With", "Warranty ends"]} rows={devices.map((device) => [
          <Link key="device" href={`/workspace/devices/${device.id}`} className="font-medium hover:underline">{device.assetTag}<span className="block text-[13px] font-normal text-muted">{deviceName(device)}</span></Link>, deviceKindLabels[device.kind], <DeviceState key="status" status={device.status} />,
          device.holder ?? <span key="none" className="text-muted">Nobody</span>, device.warrantyEndsOn ? formatDate(device.warrantyEndsOn) : <span key="warranty" className="text-muted">Not set</span>,
        ])} />
        <Pagination page={page} pages={pages} url={(next) => listUrl({ ...filters, page: next })} />
      </> : <EmptyState title={filtered ? "No matching devices" : "No devices yet"} description={filtered ? "Try a different search or status." : "Add devices one at a time, or import a CSV file."} />}
    </Section>
  </>;
}

async function Requests({ member }: { member: Member }) {
  const requests = await openDeviceRequests(member);
  return <Section title="Device requests" className="mb-9">{requests.length ? <ul className="divide-y divide-line">{requests.map((request) => <li key={request.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm">
    <div className="min-w-0"><p><Link href={`/workspace/people/${request.employeeId}`} className="font-medium hover:underline">{request.employeeName}</Link> <span className="text-muted">· {deviceKindLabels[request.kind]}</span></p><p className="text-[13px] wrap-anywhere text-muted">Asked {formatDate(request.createdAt)}{request.note && `. ${request.note}`}</p></div>
    <div className="flex flex-wrap items-center gap-2"><Link href={`/workspace/devices?status=in_stock&kind=${request.kind}`} className={`${textLink} text-[13px]`}>Find one in stock<span className="sr-only"> for {request.employeeName}</span></Link><ActionButtons action={deviceRequestAction} hidden={{ id: request.id }} name="operation" buttons={[{ value: "declined", label: "Decline", describe: `Decline ${request.employeeName}’s ${deviceKindLabels[request.kind].toLowerCase()} request`, variant: "text", confirm: { title: "Decline this request?", body: `${request.employeeName} is told it was declined.`, action: "Decline request", danger: true } }]} /></div>
  </li>)}</ul> : <Empty>No device requests are open. Assigning a device of the requested type closes the request.</Empty>}</Section>;
}

export default async function DevicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const member = await requireMember();
  const query = await searchParams;
  const admin = member.role === "admin";
  const filters = deviceFilters(query);
  const canRequest = await canRequestEquipment(member.employeeId);
  const requesting = query.request === "1" && canRequest;
  const imported = admin && /^\d{1,4}$/.test(query.imported ?? "") ? Number(query.imported) : 0;
  const [own, requests, grants] = await Promise.all([ownDevices(member), ownDeviceRequests(member), pendingGrants(member)]);
  return <>
    <PageHeader title="Devices and apps" description={admin ? "Track who has which device and which app access. OpenWarp keeps the record. It doesn’t control devices or change other systems." : "Devices and app access assigned to you."} actions={admin && <>
      <a href={listUrl({ ...filters, page: 1 }, "/workspace/devices/export")} className={secondaryButton}><DownloadSimpleIcon aria-hidden="true" size={15} /> Export CSV</a>
      <Link href="/workspace/devices/import" className={secondaryButton}><UploadSimpleIcon aria-hidden="true" size={15} /> Import CSV</Link>
      <Link href="/workspace/devices?new=1" className={primaryButton}><PlusIcon aria-hidden="true" size={15} weight="bold" /> Add device</Link>
    </>} />
    <DevicesNav current="devices" admin={admin} waiting={grants.length} />
    {imported > 0 && <Notice>{imported} {imported === 1 ? "device" : "devices"} imported.</Notice>}
    {query.saved === "requested" && <Notice>Device request sent.</Notice>}
    {admin && <Requests member={member} />}
    {admin && <Inventory filters={filters} adding={query.new === "1"} />}
    {!member.employeeId && !admin && <Callout>Your account isn’t linked to an employee record, so no devices can be assigned to you. Ask an administrator to link it.</Callout>}
    {member.employeeId && <>
      {requesting && <section className={`${panelStyle} mb-8 max-w-2xl p-5`}><h2 className="mb-4 text-[15px] font-semibold">Request a device</h2>
        <ActionForm action={requestDeviceAction} submit="Send request" pending="Sending…" secondary={<Link href="/workspace/devices" className={textButton}>Close</Link>}>
          <Field name="kind" label="Type" required options={deviceKinds.map((value) => ({ value, label: deviceKindLabels[value] }))} /><Field name="note" label="What do you need it for?" multiline maxLength={500} />
        </ActionForm></section>}
      <Section title="My devices" className="mb-9" action={canRequest && !requesting && <Link href="/workspace/devices?request=1" className={`${textLink} text-[13px]`}>Request a device</Link>}>{own.length ? <OwnDevices devices={own} /> : <Empty>No devices are assigned to you.</Empty>}</Section>
      {requests.length > 0 && <Section title="My requests"><ul className="divide-y divide-line">{requests.map((request) => <li key={request.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm"><div className="min-w-0"><p className="font-medium">{deviceKindLabels[request.kind]}</p><p className="text-[13px] text-muted">Asked {formatDate(request.createdAt)}</p></div>
        <div className="flex items-center gap-3"><span className="text-[13px] text-muted">{requestStates[request.state]}</span>{request.state === "open" && <ActionButtons action={deviceRequestAction} hidden={{ id: request.id }} name="operation" buttons={[{ value: "cancelled", label: "Cancel", describe: `Cancel ${deviceKindLabels[request.kind].toLowerCase()} request`, variant: "text", confirm: { title: "Cancel this request?", body: "You can ask again later.", action: "Cancel request", danger: true } }]} />}</div></li>)}</ul></Section>}
    </>}
  </>;
}
