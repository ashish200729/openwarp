import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import {
  deviceConditions, deviceFields, deviceKindLabels, deviceKinds, deviceStatuses, type Billing, type Criticality, type DeviceCondition, type DeviceKind, type DeviceStatus, type GrantState,
  type appDefaultFields, type appFields, type appGrantFields, type appRequestFields, type attestationFields, type closeRepairFields, type deviceAssignFields, type deviceCommandFields, type deviceRequestCommandFields,
  type deviceRequestFields, type deviceReturnFields, type deviceReturnRequestFields, type grantCommandFields, type repairFields, type workplaceSettingsFields,
} from "@/lib/domains/workplace";
import { parseCsv } from "@/lib/operations";
import { employmentTypes, formatDate, type EmploymentType } from "@/lib/people";
import { addLinkedTask, finishLinkedTasks } from "./checklists";
import { pool } from "./db";
import { requireAdmin, type Member } from "./member";
import { notify, notifyDeciders } from "./notify";
import { readCompany } from "./settings";
import { audit, ensureCurrentTeam, PeopleError, requireDecider, requireOwnEmployee, runAsAdmin, runAsMember } from "./write";

export type Device = {
  id: string; assetTag: string; kind: DeviceKind; make: string; model: string; serial: string; purchasedOn: string | null; costCents: number | null; currency: string; warrantyEndsOn: string | null;
  status: DeviceStatus; condition: DeviceCondition; notes: string; version: number; holderId: string | null; holder: string | null; assignmentId: string | null; returnDueOn: string | null; sentBack: boolean; received: boolean;
};
export type DeviceAssignment = { id: string; employeeId: string; employeeName: string; assignedAt: Date; receivedAt: Date | null; returnDueOn: string | null; sentBackAt: Date | null; returnedAt: Date | null; returnCondition: DeviceCondition | "lost" | null; returnNote: string };
export type Repair = { id: string; issue: string; reportedBy: string; reportedOn: string; vendor: string; costCents: number | null; currency: string; outcome: string; closedOn: string | null };
export type Attestation = { id: string; employeeName: string; diskEncrypted: boolean; screenLock: boolean; osUpdated: boolean; firewallOn: boolean; at: Date };
export type OwnDevice = { id: string; assignmentId: string; assetTag: string; kind: DeviceKind; make: string; model: string; serial: string; assignedAt: Date; receivedAt: Date | null; returnDueOn: string | null; sentBackAt: Date | null; attestDueOn: string; attestDue: boolean; openRepairs: number };
export type DeviceRequest = { id: string; employeeId: string; employeeName: string; kind: DeviceKind; note: string; state: "open" | "fulfilled" | "declined" | "cancelled"; createdAt: Date };
export type WorkplaceSettings = { attestDays: number; deviceFor: EmploymentType[]; version: number };
export type AppRow = {
  id: string; name: string; ownerId: string | null; owner: string | null; seatCostCents: number; billing: Billing; currency: string; seats: number | null; renewsOn: string | null; criticality: Criticality; notes: string;
  archived: boolean; version: number; used: number; waiting: number;
};
export type Grant = { id: string; appId: string; appName: string; criticality: Criticality; employeeId: string; employeeName: string; role: string; reason: string; state: GrantState; requestedAt: Date; grantedAt: Date | null; closedAt: Date | null; decidedBy: string | null };
export type AppDefault = { id: string; appId: string; appName: string; teamId: string | null; teamName: string | null; title: string; role: string };
export type DeviceFilters = { query: string; status: DeviceStatus | ""; kind: DeviceKind | ""; page: number };

export function deviceFilters(params: Record<string, string | string[] | undefined>): DeviceFilters {
  return {
    query: typeof params.q === "string" ? params.q.trim().slice(0, 120) : "", status: deviceStatuses.find((status) => status === params.status) ?? "", kind: deviceKinds.find((kind) => kind === params.kind) ?? "",
    page: typeof params.page === "string" && /^[1-9]\d{0,5}$/.test(params.page) ? Number(params.page) : 1,
  };
}

export async function readWorkplaceSettings(client: Pick<PoolClient, "query"> = pool()) {
  const { rows } = await client.query<WorkplaceSettings>(`SELECT attest_days AS "attestDays", device_for AS "deviceFor", version FROM workplace_settings`);
  return rows[0];
}

export function saveWorkplaceSettings(member: Member, input: z.infer<typeof workplaceSettingsFields>) {
  return runAsAdmin(member, async (client) => {
    const deviceFor = employmentTypes.filter((type) => input[type]);
    const { rowCount } = await client.query("UPDATE workplace_settings SET attest_days = $1, device_for = $2, version = version + 1 WHERE version = $3", [input.attestDays, deviceFor, input.version]);
    if (!rowCount) throw new PeopleError("These settings changed while you were editing. Reload and try again.");
    await audit(client, member, "settings.updated", { detail: "Devices and apps" });
  });
}

const returnDue = "least(a.return_due_on, CASE WHEN a.returned_at IS NULL AND e.status = 'offboarding' THEN e.last_day END)";

const deviceColumns = `d.id, d.asset_tag AS "assetTag", d.kind, d.make, d.model, d.serial, to_char(d.purchased_on, 'YYYY-MM-DD') AS "purchasedOn", d.cost_cents::float8 AS "costCents", d.currency,
  to_char(d.warranty_ends_on, 'YYYY-MM-DD') AS "warrantyEndsOn", d.status, d.condition, d.notes, d.version, a.employee_id AS "holderId", nullif(concat_ws(' ', e.first_name, e.last_name), '') AS holder,
  a.id AS "assignmentId", to_char(${returnDue}, 'YYYY-MM-DD') AS "returnDueOn", a.sent_back_at IS NOT NULL AS "sentBack", a.received_at IS NOT NULL AS received`;
const deviceFrom = `FROM devices d LEFT JOIN device_assignments a ON a.device_id = d.id AND a.returned_at IS NULL LEFT JOIN employees e ON e.id = a.employee_id`;
const deviceWhere = `WHERE ($1 = '' OR strpos(lower(concat_ws(' ', d.asset_tag, d.make, d.model, d.serial, e.first_name, e.last_name)), lower($1)) > 0) AND ($2 = '' OR d.status = $2) AND ($3 = '' OR d.kind = $3)`;

export async function listDevices(filters: DeviceFilters, size = 25) {
  await requireAdmin();
  const values = [filters.query, filters.status, filters.kind];
  const { rows: [{ total }] } = await pool().query<{ total: number }>(`SELECT count(*)::int AS total ${deviceFrom} ${deviceWhere}`, values);
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(filters.page, pages);
  const { rows } = await pool().query<Device>(`SELECT ${deviceColumns} ${deviceFrom} ${deviceWhere} ORDER BY lower(d.asset_tag) LIMIT $4 OFFSET $5`, [...values, size, (page - 1) * size]);
  return { devices: rows, total, page, pages };
}

export async function deviceSummary() {
  await requireAdmin();
  const { rows } = await pool().query<{ status: DeviceStatus; count: number }>("SELECT status, count(*)::int AS count FROM devices GROUP BY status");
  return new Map(rows.map((row) => [row.status, row.count]));
}

export function exportDevices(member: Member, filters: DeviceFilters) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<Device>(`SELECT ${deviceColumns} ${deviceFrom} ${deviceWhere} ORDER BY lower(d.asset_tag) LIMIT 10001`, [filters.query, filters.status, filters.kind]);
    if (rows.length > 10_000) throw new PeopleError("The export exceeds 10,000 devices. Narrow the filters.");
    await audit(client, member, "device.exported", { detail: `${rows.length} records` });
    return rows;
  });
}

export async function readDevice(id: string) {
  await requireAdmin();
  const { rows: [device] } = await pool().query<Device>(`SELECT ${deviceColumns} ${deviceFrom} WHERE d.id = $1`, [id]);
  if (!device) return null;
  const [assignments, repairs, attestations] = await Promise.all([
    pool().query<DeviceAssignment>(
      `SELECT a.id, a.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", a.assigned_at AS "assignedAt", a.received_at AS "receivedAt", to_char(${returnDue}, 'YYYY-MM-DD') AS "returnDueOn",
       a.sent_back_at AS "sentBackAt", a.returned_at AS "returnedAt", a.return_condition AS "returnCondition", a.return_note AS "returnNote"
       FROM device_assignments a JOIN employees e ON e.id = a.employee_id WHERE a.device_id = $1 ORDER BY a.assigned_at DESC LIMIT 100`, [id],
    ),
    pool().query<Repair>(
      `SELECT r.id, r.issue, u.name AS "reportedBy", to_char(r.reported_on, 'YYYY-MM-DD') AS "reportedOn", r.vendor, r.cost_cents::float8 AS "costCents", r.currency, r.outcome, to_char(r.closed_on, 'YYYY-MM-DD') AS "closedOn"
       FROM device_repairs r JOIN "user" u ON u.id = r.reported_by WHERE r.device_id = $1 ORDER BY r.closed_on IS NOT NULL, r.reported_on DESC, r.id LIMIT 100`, [id],
    ),
    pool().query<Attestation>(
      `SELECT t.id::text, concat_ws(' ', e.first_name, e.last_name) AS "employeeName", t.disk_encrypted AS "diskEncrypted", t.screen_lock AS "screenLock", t.os_updated AS "osUpdated", t.firewall_on AS "firewallOn", t.attested_at AS at
       FROM device_attestations t JOIN device_assignments a ON a.id = t.assignment_id JOIN employees e ON e.id = a.employee_id WHERE a.device_id = $1 ORDER BY t.id DESC LIMIT 20`, [id],
    ),
  ]);
  return { device, assignments: assignments.rows, repairs: repairs.rows, attestations: attestations.rows };
}

async function currentDevice(client: PoolClient, id: string, version?: number) {
  const { rows: [device] } = await client.query<{ assetTag: string; kind: DeviceKind; status: DeviceStatus; version: number; assignmentId: string | null; holderId: string | null; returnDueOn: string | null }>(
    `SELECT d.asset_tag AS "assetTag", d.kind, d.status, d.version, a.id AS "assignmentId", a.employee_id AS "holderId", to_char(${returnDue}, 'YYYY-MM-DD') AS "returnDueOn" ${deviceFrom} WHERE d.id = $1`, [id],
  );
  if (!device) throw new PeopleError("This device could not be found.");
  if (version !== undefined && device.version !== version) throw new PeopleError("This device changed while you were editing. Reload it and try again.");
  return device;
}

async function ensureTagFree(client: PoolClient, assetTag: string, id: string | null) {
  const { rowCount } = await client.query("SELECT 1 FROM devices WHERE lower(asset_tag) = lower($1) AND id IS DISTINCT FROM $2::uuid", [assetTag, id]);
  if (rowCount) throw new PeopleError(`Another device already uses the asset tag ${assetTag}.`);
}

type DeviceInput = z.infer<typeof deviceFields>;
const deviceValues = (input: DeviceInput) => [input.assetTag, input.kind, input.make, input.model, input.serial, input.purchasedOn, input.cost, input.currency, input.warrantyEndsOn, input.condition, input.notes];

async function insertDevice(client: PoolClient, input: DeviceInput) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO devices (asset_tag, kind, make, model, serial, purchased_on, cost_cents, currency, warranty_ends_on, condition, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`, deviceValues(input),
  );
  return rows[0].id;
}

export function saveDevice(member: Member, input: DeviceInput) {
  return runAsAdmin(member, async (client) => {
    await ensureTagFree(client, input.assetTag, input.id || null);
    if (!input.id) {
      const id = await insertDevice(client, input);
      await audit(client, member, "device.added", { detail: input.assetTag });
      return id;
    }
    await currentDevice(client, input.id, input.version);
    await client.query(
      `UPDATE devices SET asset_tag = $1, kind = $2, make = $3, model = $4, serial = $5, purchased_on = $6, cost_cents = $7, currency = $8, warranty_ends_on = $9, condition = $10, notes = $11, version = version + 1 WHERE id = $12`,
      [...deviceValues(input), input.id],
    );
    await audit(client, member, "device.updated", { detail: input.assetTag });
    return input.id;
  });
}

export function setDeviceStatus(member: Member, input: z.infer<typeof deviceCommandFields>) {
  return runAsAdmin(member, async (client) => {
    const device = await currentDevice(client, input.id, input.version);
    if (device.assignmentId) throw new PeopleError("Record the return before changing this device’s status.");
    await client.query("UPDATE devices SET status = $2, version = version + 1 WHERE id = $1", [input.id, input.status]);
    await audit(client, member, "device.updated", { detail: `${device.assetTag}: ${input.status.replaceAll("_", " ")}` });
  });
}

export function assignDevice(member: Member, input: z.infer<typeof deviceAssignFields>) {
  return runAsAdmin(member, async (client) => {
    const device = await currentDevice(client, input.id, input.version);
    if (device.assignmentId || device.status !== "in_stock") throw new PeopleError("Only a device in stock can be assigned.");
    const { rowCount } = await client.query("SELECT 1 FROM employees WHERE id = $1 AND status IN ('onboarding', 'active')", [input.employeeId]);
    if (!rowCount) throw new PeopleError("Choose someone who is active or onboarding.");
    await client.query("INSERT INTO device_assignments (device_id, employee_id, assigned_by) VALUES ($1, $2, $3)", [input.id, input.employeeId, member.id]);
    await client.query("UPDATE devices SET status = 'assigned', version = version + 1 WHERE id = $1", [input.id]);
    await client.query("UPDATE device_requests SET state = 'fulfilled', device_id = $3, closed_by = $4, closed_at = now() WHERE employee_id = $1 AND kind = $2 AND state = 'open'", [input.employeeId, device.kind, input.id, member.id]);
    if (device.kind === "laptop" || device.kind === "desktop") await finishLinkedTasks(client, member, input.employeeId, { area: "device" });
    await audit(client, member, "device.assigned", { employeeId: input.employeeId, detail: device.assetTag });
    await notify(client, member, { employeeId: input.employeeId }, { title: `A ${deviceKindLabels[device.kind].toLowerCase()} was assigned to you`, body: "Confirm it when it arrives.", href: "/workspace/devices" });
  });
}

export function askForReturn(member: Member, input: z.infer<typeof deviceReturnRequestFields>) {
  return runAsAdmin(member, async (client) => {
    const device = await currentDevice(client, input.id);
    if (!device.assignmentId || !device.holderId) throw new PeopleError("This device isn’t assigned to anyone.");
    await client.query("UPDATE device_assignments SET return_due_on = $2 WHERE id = $1", [device.assignmentId, input.dueOn]);
    await audit(client, member, "device.return_requested", { employeeId: device.holderId, detail: device.assetTag });
    await notify(client, member, { employeeId: device.holderId }, { title: `Return device ${device.assetTag}`, body: `Due ${formatDate(input.dueOn)}`, href: "/workspace/devices" });
  });
}

export function returnDevice(member: Member, input: z.infer<typeof deviceReturnFields>) {
  return runAsAdmin(member, async (client) => {
    const device = await currentDevice(client, input.id, input.version);
    if (!device.assignmentId || !device.holderId) throw new PeopleError("This device was already returned.");
    const lost = input.condition === "lost";
    await client.query("UPDATE device_assignments SET returned_at = now(), returned_to = $2, return_condition = $3, return_note = $4, return_due_on = $5 WHERE id = $1", [device.assignmentId, member.id, input.condition, input.note, device.returnDueOn]);
    await client.query("UPDATE devices SET status = $2, condition = CASE WHEN $3 = 'lost' THEN condition ELSE $3 END, version = version + 1 WHERE id = $1", [input.id, lost ? "lost" : input.next, input.condition]);
    await finishLinkedTasks(client, member, device.holderId, { area: "device", deviceId: input.id });
    await audit(client, member, "device.returned", { employeeId: device.holderId, detail: lost ? `${device.assetTag}, recorded as lost` : device.assetTag });
    await notify(client, member, { employeeId: device.holderId }, { title: lost ? `Device ${device.assetTag} was recorded as lost` : `The return of device ${device.assetTag} was recorded`, href: "/workspace/devices" });
  });
}

async function ownAssignment(client: PoolClient, employeeId: string, assignmentId: string) {
  const { rows: [row] } = await client.query<{ deviceId: string; assetTag: string; received: boolean; sentBack: boolean }>(
    `SELECT d.id AS "deviceId", d.asset_tag AS "assetTag", a.received_at IS NOT NULL AS received, a.sent_back_at IS NOT NULL AS "sentBack" FROM device_assignments a JOIN devices d ON d.id = a.device_id
     WHERE a.id = $1 AND a.employee_id = $2 AND a.returned_at IS NULL`, [assignmentId, employeeId],
  );
  if (!row) throw new PeopleError("This device is no longer assigned to you.");
  return row;
}

export function confirmDevice(member: Member, assignmentId: string) {
  return runAsMember(member, async (client, actor) => {
    const employeeId = await requireOwnEmployee(client, actor);
    const device = await ownAssignment(client, employeeId, assignmentId);
    if (device.received) return;
    await client.query("UPDATE device_assignments SET received_at = now() WHERE id = $1", [assignmentId]);
    await audit(client, member, "device.received", { employeeId, detail: device.assetTag });
  });
}

export function sendBackDevice(member: Member, assignmentId: string) {
  return runAsMember(member, async (client, actor) => {
    const employeeId = await requireOwnEmployee(client, actor);
    const device = await ownAssignment(client, employeeId, assignmentId);
    if (device.sentBack) return;
    await client.query("UPDATE device_assignments SET sent_back_at = now() WHERE id = $1", [assignmentId]);
    await audit(client, member, "device.sent_back", { employeeId, detail: device.assetTag });
    await notify(client, member, { role: "admin" }, { title: `${member.name} sent back device ${device.assetTag}`, body: "Record the return when it arrives.", href: `/workspace/devices/${device.deviceId}` });
  });
}

export function attestDevice(member: Member, input: z.infer<typeof attestationFields>) {
  return runAsMember(member, async (client, actor) => {
    const employeeId = await requireOwnEmployee(client, actor);
    const device = await ownAssignment(client, employeeId, input.assignmentId);
    if (!device.received) throw new PeopleError("Confirm you have this device first.");
    await client.query("INSERT INTO device_attestations (assignment_id, disk_encrypted, screen_lock, os_updated, firewall_on, attested_by) VALUES ($1, $2, $3, $4, $5, $6)",
      [input.assignmentId, input.diskEncrypted, input.screenLock, input.osUpdated, input.firewallOn, member.id]);
    const missing = [input.diskEncrypted, input.screenLock, input.osUpdated, input.firewallOn].filter((value) => !value).length;
    await audit(client, member, "device.attested", { employeeId, detail: missing ? `${device.assetTag}, ${missing} not met` : device.assetTag });
    if (missing) await notify(client, member, { role: "admin" }, { title: `${member.name} reported a security gap on ${device.assetTag}`, body: `${missing} of 4 checks aren’t met.`, href: `/workspace/devices/${device.deviceId}` });
  });
}

export function reportRepair(member: Member, input: z.infer<typeof repairFields>) {
  return runAsMember(member, async (client, actor) => {
    const device = await currentDevice(client, input.deviceId);
    if (actor.role !== "admin" && (!actor.employeeId || device.holderId !== actor.employeeId)) throw new PeopleError("You can only report a problem with a device assigned to you.");
    const { currency } = await readCompany(client);
    await client.query("INSERT INTO device_repairs (device_id, issue, reported_by, currency) VALUES ($1, $2, $3, $4)", [input.deviceId, input.issue, member.id, currency]);
    await audit(client, member, "device.repair_reported", { employeeId: device.holderId ?? undefined, detail: device.assetTag });
    await notify(client, member, { role: "admin" }, { title: `${member.name} reported a problem with ${device.assetTag}`, href: `/workspace/devices/${input.deviceId}` });
  });
}

export function closeRepair(member: Member, input: z.infer<typeof closeRepairFields>) {
  return runAsAdmin(member, async (client) => {
    const { rows: [repair] } = await client.query<{ deviceId: string }>(
      `UPDATE device_repairs SET vendor = $2, cost_cents = $3, outcome = $4, closed_on = current_date, closed_by = $5 WHERE id = $1 AND closed_on IS NULL RETURNING device_id AS "deviceId"`,
      [input.id, input.vendor, input.cost, input.outcome, member.id],
    );
    if (!repair) throw new PeopleError("This repair is already closed.");
    const device = await currentDevice(client, repair.deviceId);
    await audit(client, member, "device.repair_closed", { employeeId: device.holderId ?? undefined, detail: device.assetTag });
    if (device.holderId) await notify(client, member, { employeeId: device.holderId }, { title: `The problem with ${device.assetTag} was closed`, body: input.outcome, href: "/workspace/devices" });
  });
}

const attestDue = "(coalesce((SELECT max(t.attested_at) FROM device_attestations t WHERE t.assignment_id = a.id)::date + s.attest_days, a.received_at::date, a.assigned_at::date))";

export async function ownDevices(member: Member) {
  if (!member.employeeId) return [];
  const { rows } = await pool().query<OwnDevice>(
    `SELECT d.id, a.id AS "assignmentId", d.asset_tag AS "assetTag", d.kind, d.make, d.model, d.serial, a.assigned_at AS "assignedAt", a.received_at AS "receivedAt", to_char(${returnDue}, 'YYYY-MM-DD') AS "returnDueOn",
     a.sent_back_at AS "sentBackAt", to_char(${attestDue}, 'YYYY-MM-DD') AS "attestDueOn", a.received_at IS NOT NULL AND a.sent_back_at IS NULL AND d.kind IN ('laptop', 'desktop', 'phone', 'tablet') AND ${attestDue} <= current_date AS "attestDue",
     (SELECT count(*)::int FROM device_repairs r WHERE r.device_id = d.id AND r.closed_on IS NULL) AS "openRepairs"
     FROM device_assignments a JOIN devices d ON d.id = a.device_id JOIN employees e ON e.id=a.employee_id CROSS JOIN workplace_settings s WHERE a.employee_id = $1 AND a.returned_at IS NULL ORDER BY a.assigned_at DESC LIMIT 50`, [member.employeeId],
  );
  return rows;
}

const requestColumns = `r.id, r.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", r.kind, r.note, r.state, r.created_at AS "createdAt" FROM device_requests r JOIN employees e ON e.id = r.employee_id`;

export async function openDeviceRequests(member: Member) {
  if (member.role !== "admin") return [];
  const { rows } = await pool().query<DeviceRequest>(`SELECT ${requestColumns} WHERE r.state = 'open' AND e.status IN ('onboarding', 'active') ORDER BY r.created_at, r.id LIMIT 60`);
  return rows;
}

export async function ownDeviceRequests(member: Member) {
  if (!member.employeeId) return [];
  const { rows } = await pool().query<DeviceRequest>(`SELECT ${requestColumns} WHERE r.employee_id = $1 ORDER BY r.created_at DESC, r.id LIMIT 12`, [member.employeeId]);
  return rows;
}

export async function canRequestEquipment(employeeId: string | null, db: Pick<PoolClient, "query"> = pool()) {
  if (!employeeId) return false;
  const { rowCount } = await db.query("SELECT 1 FROM employees WHERE id = $1 AND status IN ('onboarding', 'active')", [employeeId]);
  return Boolean(rowCount);
}

async function requireEquipmentRecipient(client: PoolClient, employeeId: string) {
  if (!await canRequestEquipment(employeeId, client)) throw new PeopleError("New equipment and app access are only available to active or onboarding employees.");
}

export function requestDevice(member: Member, input: z.infer<typeof deviceRequestFields>) {
  return runAsMember(member, async (client, actor) => {
    const employeeId = await requireOwnEmployee(client, actor);
    await requireEquipmentRecipient(client, employeeId);
    const { rowCount } = await client.query("INSERT INTO device_requests (employee_id, kind, note) VALUES ($1, $2, $3) ON CONFLICT (employee_id, kind) WHERE state = 'open' DO NOTHING", [employeeId, input.kind, input.note]);
    if (!rowCount) throw new PeopleError("You already have an open request for that type.");
    await audit(client, member, "device.requested", { employeeId, detail: deviceKindLabels[input.kind] });
    await notify(client, member, { role: "admin" }, { title: `${member.name} requested a ${deviceKindLabels[input.kind].toLowerCase()}`, href: "/workspace/devices", kind: "request" });
  });
}

export function closeDeviceRequest(member: Member, input: z.infer<typeof deviceRequestCommandFields>) {
  return runAsMember(member, async (client, actor) => {
    const { rows: [request] } = await client.query<{ employeeId: string; kind: DeviceKind }>(`SELECT employee_id AS "employeeId", kind FROM device_requests WHERE id = $1 AND state = 'open'`, [input.id]);
    if (!request) throw new PeopleError("This request is already closed.");
    if (input.operation === "cancelled" ? actor.employeeId !== request.employeeId : actor.role !== "admin") throw new PeopleError("Only an administrator can decline a device request.");
    await client.query("UPDATE device_requests SET state = $2, closed_by = $3, closed_at = now() WHERE id = $1", [input.id, input.operation, member.id]);
    await audit(client, member, "device.request_closed", { employeeId: request.employeeId, detail: `${deviceKindLabels[request.kind]}, ${input.operation}` });
    if (input.operation === "declined") await notify(client, member, { employeeId: request.employeeId }, { title: `Your ${deviceKindLabels[request.kind].toLowerCase()} request was declined`, href: "/workspace/devices" });
  });
}

export const deviceImportColumns = ["asset_tag", "type", "make", "model", "serial", "purchase_date", "cost", "currency", "warranty_end", "condition", "notes"] as const;
export type ImportIssue = { row: number; message: string };

async function planDevices(client: Pick<PoolClient, "query">, csv: string) {
  const [header, ...body] = parseCsv(csv);
  if (!header) throw new PeopleError("The file is empty.");
  const names = header.map((value) => value.trim().toLowerCase().replaceAll(/[\s-]+/g, "_"));
  const missing = ["asset_tag", "type", "model"].filter((name) => !names.includes(name));
  if (missing.length) throw new PeopleError(`Add these columns: ${missing.join(", ")}.`);
  if (!body.length) throw new PeopleError("The file has no rows under the header.");
  if (body.length > 1000) throw new PeopleError("Import at most 1,000 rows at a time.");
  const [{ currency }, { rows: existing }] = await Promise.all([readCompany(client as PoolClient), client.query<{ tag: string }>("SELECT lower(asset_tag) AS tag FROM devices")]);
  const tags = new Set(existing.map((row) => row.tag));
  const problems: ImportIssue[] = [];
  const devices: DeviceInput[] = [];
  body.forEach((cells, index) => {
    const value = (name: (typeof deviceImportColumns)[number]) => names.includes(name) ? (cells[names.indexOf(name)] ?? "").trim() : "";
    const row = index + 2;
    const result = deviceFields.safeParse({
      assetTag: value("asset_tag"), kind: value("type").toLowerCase() || "laptop", make: value("make"), model: value("model"), serial: value("serial"), purchasedOn: value("purchase_date"), cost: value("cost"),
      currency: value("currency").toUpperCase() || currency, warrantyEndsOn: value("warranty_end"), condition: value("condition").toLowerCase() || "good", notes: value("notes"),
    });
    if (!result.success) {
      problems.push({ row, message: result.error.issues.map((issue) => issue.path[0] === "kind" ? `Use one of these types: ${deviceKinds.join(", ")}.` : issue.path[0] === "condition" ? `Use one of these conditions: ${deviceConditions.join(", ")}.` : issue.message).join(" ") });
      return;
    }
    const tag = result.data.assetTag.toLowerCase();
    if (tags.has(tag)) problems.push({ row, message: `The asset tag ${result.data.assetTag} is already used.` });
    tags.add(tag);
    devices.push(result.data);
  });
  return { devices, problems };
}

export async function checkDeviceImport(csv: string) {
  await requireAdmin();
  const { devices, problems } = await planDevices(pool(), csv);
  return { count: devices.length, problems: problems.slice(0, 100) };
}

export function importDevices(member: Member, csv: string) {
  return runAsAdmin(member, async (client) => {
    const { devices, problems } = await planDevices(client, csv);
    if (problems.length) throw new PeopleError("The file has problems. Check it again before importing.");
    for (const device of devices) await insertDevice(client, device);
    await audit(client, member, "device.imported", { detail: `${devices.length} records` });
    return devices.length;
  });
}

const appColumns = `p.id, p.name, p.owner_id AS "ownerId", nullif(concat_ws(' ', o.first_name, o.last_name), '') AS owner, p.seat_cost_cents::float8 AS "seatCostCents", p.billing, p.currency, p.seats, to_char(p.renews_on, 'YYYY-MM-DD') AS "renewsOn",
  p.criticality, p.notes, p.archived_at IS NOT NULL AS archived, p.version,
  (SELECT count(*)::int FROM app_grants g WHERE g.app_id = p.id AND g.state = 'granted') AS used, (SELECT count(*)::int FROM app_grants g WHERE g.app_id = p.id AND g.state IN ('requested', 'approved')) AS waiting
  FROM apps p LEFT JOIN employees o ON o.id = p.owner_id`;
const grantColumns = `g.id, p.id AS "appId", p.name AS "appName", p.criticality, g.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", g.role, g.reason, g.state, g.requested_at AS "requestedAt",
  g.granted_at AS "grantedAt", g.closed_at AS "closedAt", u.name AS "decidedBy" FROM app_grants g JOIN apps p ON p.id = g.app_id JOIN employees e ON e.id = g.employee_id LEFT JOIN "user" u ON u.id = g.decided_by`;

export async function listApps(member: Member) {
  if (member.role !== "admin") return [];
  const { rows } = await pool().query<AppRow>(`SELECT ${appColumns} WHERE p.archived_at IS NULL ORDER BY lower(p.name) LIMIT 500`);
  return rows;
}

// What a seat costs over a year. Seats that were bought are counted even when nobody uses them.
export function annualCost(app: AppRow) {
  return app.seatCostCents * Math.max(app.used, app.seats ?? 0) * (app.billing === "monthly" ? 12 : 1);
}

export async function appChoices() {
  const { rows } = await pool().query<{ id: string; name: string }>("SELECT id, name FROM apps WHERE archived_at IS NULL ORDER BY lower(name) LIMIT 500");
  return rows;
}

export async function readApp(id: string) {
  await requireAdmin();
  const { rows: [app] } = await pool().query<AppRow>(`SELECT ${appColumns} WHERE p.id = $1`, [id]);
  if (!app) return null;
  const { rows: grants } = await pool().query<Grant>(`SELECT ${grantColumns} WHERE g.app_id = $1 ORDER BY g.closed_at IS NOT NULL, lower(e.last_name), e.id, g.requested_at DESC LIMIT 500`, [id]);
  return { app, grants };
}

export async function ownGrants(member: Member) {
  if (!member.employeeId) return [];
  const { rows } = await pool().query<Grant>(`SELECT ${grantColumns} WHERE g.employee_id = $1 ORDER BY g.closed_at IS NOT NULL, lower(p.name), g.requested_at DESC LIMIT 60`, [member.employeeId]);
  return rows;
}

// Managers approve requests from their direct reports. Administrators see those and the approved ones still to set up.
export async function pendingGrants(member: Member) {
  if (member.role !== "admin" && !member.managesPeople) return [];
  const { rows } = await pool().query<Grant>(
    `SELECT ${grantColumns} WHERE e.status IN ('active', 'onboarding') AND ($1 = 'admin' AND g.state IN ('requested', 'approved') OR $1 <> 'admin' AND g.state = 'requested' AND e.manager_id = $2) ORDER BY g.state DESC, g.requested_at, g.id LIMIT 100`,
    [member.role, member.employeeId],
  );
  return rows;
}

export function saveApp(member: Member, input: z.infer<typeof appFields>) {
  return runAsAdmin(member, async (client) => {
    const { rowCount: taken } = await client.query("SELECT 1 FROM apps WHERE lower(name) = lower($1) AND id IS DISTINCT FROM $2::uuid", [input.name, input.id || null]);
    if (taken) throw new PeopleError("An app with that name is already in the register.");
    const values = [input.name, input.ownerId, input.seatCost, input.billing, input.currency, input.seats, input.renewsOn, input.criticality, input.notes];
    const { rows: [app] } = input.id ? await client.query<{ id: string }>(
      `UPDATE apps SET name = $1, owner_id = $2, seat_cost_cents = $3, billing = $4, currency = $5, seats = $6, renews_on = $7, criticality = $8, notes = $9, version = version + 1 WHERE id = $10 AND version = $11 AND archived_at IS NULL RETURNING id`,
      [...values, input.id, input.version],
    ) : await client.query<{ id: string }>(`INSERT INTO apps (name, owner_id, seat_cost_cents, billing, currency, seats, renews_on, criticality, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, values);
    if (!app) throw new PeopleError("This app changed while you were editing. Reload it and try again.");
    await audit(client, member, input.id ? "app.updated" : "app.added", { detail: input.name });
    return app.id;
  });
}

export function archiveApp(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rowCount: used } = await client.query("SELECT 1 FROM app_grants WHERE app_id = $1 AND state IN ('requested', 'approved', 'granted') LIMIT 1", [id]);
    if (used) throw new PeopleError("Close every request and record that access was removed before archiving this app.");
    const { rows: [app] } = await client.query<{ name: string }>("UPDATE apps SET archived_at = now(), name = left(name, 60) || ' (archived ' || left(id::text, 4) || ')', version = version + 1 WHERE id = $1 AND archived_at IS NULL RETURNING name", [id]);
    if (!app) throw new PeopleError("This app is already archived.");
    await client.query("DELETE FROM app_defaults WHERE app_id = $1", [id]);
    await audit(client, member, "app.archived", { detail: app.name });
  });
}

async function activeApp(client: PoolClient, id: string) {
  const { rows: [app] } = await client.query<{ name: string }>("SELECT name FROM apps WHERE id = $1 AND archived_at IS NULL", [id]);
  if (!app) throw new PeopleError("Choose an app from the register.");
  return app;
}

async function insertGrant(client: PoolClient, member: Member, input: { appId: string; employeeId: string; role: string; reason?: string; state: "requested" | "approved" | "granted" }) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO app_grants (app_id, employee_id, role, reason, state, requested_by, decided_by, decided_at, granted_by, granted_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5 <> 'requested' THEN $6 END, CASE WHEN $5 <> 'requested' THEN now() END, CASE WHEN $5 = 'granted' THEN $6 END, CASE WHEN $5 = 'granted' THEN now() END)
     ON CONFLICT (app_id, employee_id) WHERE state IN ('requested', 'approved', 'granted') DO NOTHING RETURNING id`,
    [input.appId, input.employeeId, input.role, input.reason ?? "", input.state, member.id],
  );
  return rows[0]?.id ?? null;
}

export function requestApp(member: Member, input: z.infer<typeof appRequestFields>) {
  return runAsMember(member, async (client, actor) => {
    const employeeId = await requireOwnEmployee(client, actor);
    await requireEquipmentRecipient(client, employeeId);
    const app = await activeApp(client, input.appId);
    if (!await insertGrant(client, member, { ...input, employeeId, state: "requested" })) throw new PeopleError(`You already have access to ${app.name} or an open request for it.`);
    await audit(client, member, "access.requested", { employeeId, detail: app.name });
    await notifyDeciders(client, member, employeeId, { title: `${member.name} requested access to ${app.name}`, body: input.role, href: "/workspace/devices/apps" });
  });
}

export function grantApp(member: Member, input: z.infer<typeof appGrantFields>) {
  return runAsAdmin(member, async (client) => {
    const app = await activeApp(client, input.appId);
    await requireEquipmentRecipient(client, input.employeeId);
    if (!await insertGrant(client, member, { ...input, state: "granted" })) throw new PeopleError(`This person already has access to ${app.name} or an open request for it.`);
    await audit(client, member, "access.granted", { employeeId: input.employeeId, detail: app.name });
    await notify(client, member, { employeeId: input.employeeId }, { title: `You have access to ${app.name}`, body: input.role, href: "/workspace/devices/apps" });
  });
}

const grantFrom: Record<z.infer<typeof grantCommandFields>["operation"], GrantState[]> = { approved: ["requested"], declined: ["requested", "approved"], withdrawn: ["requested", "approved"], granted: ["requested", "approved"], revoked: ["granted"] };

export function commandGrant(member: Member, input: z.infer<typeof grantCommandFields>) {
  return runAsMember(member, async (client, actor) => {
    const { operation } = input;
    const { rows: [grant] } = await client.query<{ employeeId: string; appName: string; state: GrantState }>(
      `SELECT g.employee_id AS "employeeId", p.name AS "appName", g.state FROM app_grants g JOIN apps p ON p.id = g.app_id WHERE g.id = $1`, [input.id],
    );
    if (!grant) throw new PeopleError("This access record could not be found.");
    if (operation === "withdrawn") {
      if (actor.employeeId !== grant.employeeId) throw new PeopleError("You can only withdraw your own requests.");
    } else if (operation === "granted" || operation === "revoked") {
      if (actor.role !== "admin") throw new PeopleError("Only an administrator can record access.");
    } else await requireDecider(client, actor, grant.employeeId);
    if (operation === "approved" || operation === "granted") await requireEquipmentRecipient(client, grant.employeeId);
    if (!grantFrom[operation].includes(grant.state)) throw new PeopleError("This access record already changed. Reload the page.");
    if (operation === "declined" && grant.state === "approved" && actor.role !== "admin") throw new PeopleError("This request was already approved.");
    const decides = operation === "approved" || operation === "declined" || operation === "granted";
    const closes = operation === "declined" || operation === "withdrawn" || operation === "revoked";
    await client.query(
      `UPDATE app_grants SET state = $2, decided_by = CASE WHEN $4 THEN coalesce(decided_by, $3) ELSE decided_by END, decided_at = CASE WHEN $4 THEN coalesce(decided_at, now()) ELSE decided_at END,
       granted_by = CASE WHEN $2 = 'granted' THEN $3 ELSE granted_by END, granted_at = CASE WHEN $2 = 'granted' THEN now() ELSE granted_at END,
       closed_by = CASE WHEN $5 THEN $3 END, closed_at = CASE WHEN $5 THEN now() END WHERE id = $1`, [input.id, operation, member.id, decides, closes],
    );
    if (operation !== "approved") await finishLinkedTasks(client, member, grant.employeeId, { area: "app", grantId: input.id });
    await audit(client, member, `access.${operation}`, { employeeId: grant.employeeId, detail: grant.appName });
    if (operation === "approved") await notify(client, member, { role: "admin" }, { title: `Set up ${grant.appName} access`, body: `${member.name} approved it.`, href: "/workspace/devices/apps", kind: "request" });
    const outcome = { approved: "was approved", declined: "was declined", granted: "is ready", revoked: "was removed", withdrawn: "" }[operation];
    if (outcome) await notify(client, member, { employeeId: grant.employeeId }, { title: `Your access to ${grant.appName} ${outcome}`, href: "/workspace/devices/apps" });
  });
}

export async function listAppDefaults() {
  await requireAdmin();
  const { rows } = await pool().query<AppDefault>(
    `SELECT d.id, p.id AS "appId", p.name AS "appName", d.team_id AS "teamId", t.name AS "teamName", d.title, d.role FROM app_defaults d JOIN apps p ON p.id = d.app_id LEFT JOIN teams t ON t.id = d.team_id ORDER BY lower(p.name), t.name NULLS FIRST, d.title`,
  );
  return rows;
}

export function addAppDefault(member: Member, input: z.infer<typeof appDefaultFields>) {
  return runAsAdmin(member, async (client) => {
    await ensureCurrentTeam(client, input.teamId);
    const app = await activeApp(client, input.appId);
    const { rowCount } = await client.query("INSERT INTO app_defaults (app_id, team_id, title, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [input.appId, input.teamId, input.title, input.role]);
    if (!rowCount) throw new PeopleError("That default already exists.");
    await audit(client, member, "app.default_added", { teamId: input.teamId ?? undefined, detail: app.name });
  });
}

export function removeAppDefault(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rows: [row] } = await client.query<{ name: string }>("DELETE FROM app_defaults d USING apps p WHERE d.id = $1 AND p.id = d.app_id RETURNING p.name", [id]);
    if (row) await audit(client, member, "app.default_removed", { detail: row.name });
  });
}

export function exportApps(member: Member) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<AppRow>(`SELECT ${appColumns} WHERE p.archived_at IS NULL ORDER BY lower(p.name)`);
    const { rows: grants } = await client.query<Grant & { email: string }>(`SELECT ${grantColumns.replace(" FROM app_grants", ", e.email FROM app_grants")} WHERE g.state IN ('requested', 'approved', 'granted') ORDER BY lower(p.name), lower(e.last_name), e.id LIMIT 20000`);
    await audit(client, member, "app.exported", { detail: `${rows.length} apps` });
    return { apps: rows, grants };
  });
}

export async function setUpWorkplace(client: PoolClient, member: Member, employeeId: string) {
  const { rows: [employee] } = await client.query<{ teamId: string | null; title: string; employmentType: EmploymentType; hireDate: string }>(
    `SELECT team_id AS "teamId", title, employment_type AS "employmentType", to_char(hire_date, 'YYYY-MM-DD') AS "hireDate" FROM employees WHERE id = $1`, [employeeId],
  );
  const { deviceFor } = await readWorkplaceSettings(client);
  if (deviceFor.includes(employee.employmentType)) {
    const { rowCount } = await client.query("INSERT INTO device_requests (employee_id, kind, note) SELECT $1, 'laptop', 'New hire' WHERE NOT EXISTS (SELECT 1 FROM device_assignments WHERE employee_id = $1 AND returned_at IS NULL) ON CONFLICT (employee_id, kind) WHERE state = 'open' DO NOTHING", [employeeId]);
    if (rowCount) await addLinkedTask(client, employeeId, "Assign a laptop", { area: "device" }, employee.hireDate);
  }
  // The most specific default sets the role when several name the same app.
  const { rows: defaults } = await client.query<{ appId: string; name: string; role: string }>(
    `SELECT DISTINCT ON (d.app_id) d.app_id AS "appId", p.name, d.role FROM app_defaults d JOIN apps p ON p.id = d.app_id AND p.archived_at IS NULL
     WHERE (d.team_id IS NULL OR d.team_id = $1) AND (d.title = '' OR strpos(lower($2), lower(d.title)) > 0) ORDER BY d.app_id, (d.title <> '')::int + (d.team_id IS NOT NULL)::int DESC`, [employee.teamId, employee.title],
  );
  for (const { appId, name, role } of defaults) {
    const grantId = await insertGrant(client, member, { appId, employeeId, role, reason: "Default for new hires", state: "approved" });
    if (grantId) await addLinkedTask(client, employeeId, `Set up ${name} access (${role})`, { area: "app", grantId }, employee.hireDate);
  }
}

export async function closeWorkplace(client: PoolClient, member: Member, employeeId: string) {
  const { rows: [employee] } = await client.query<{ lastDay: string | null }>(`SELECT to_char(last_day, 'YYYY-MM-DD') AS "lastDay" FROM employees WHERE id = $1`, [employeeId]);
  const { rows: grants } = await client.query<{ id: string; name: string }>("SELECT g.id, p.name FROM app_grants g JOIN apps p ON p.id = g.app_id WHERE g.employee_id = $1 AND g.state = 'granted' ORDER BY lower(p.name)", [employeeId]);
  for (const grant of grants) await addLinkedTask(client, employeeId, `Remove ${grant.name} access`, { area: "app", grantId: grant.id }, employee.lastDay);
  const { rows: devices } = await client.query<{ id: string; assetTag: string; kind: DeviceKind }>(
    `SELECT d.id, d.asset_tag AS "assetTag", d.kind FROM device_assignments a JOIN devices d ON d.id = a.device_id WHERE a.employee_id = $1 AND a.returned_at IS NULL ORDER BY lower(d.asset_tag)`, [employeeId],
  );
  for (const device of devices) await addLinkedTask(client, employeeId, `Collect ${deviceKindLabels[device.kind].toLowerCase()} ${device.assetTag}`, { area: "device", deviceId: device.id }, employee.lastDay);
  if (!devices.length) return;
  await notify(client, member, { employeeId }, { title: devices.length === 1 ? `Return device ${devices[0].assetTag}` : `Return ${devices.length} devices`, body: employee.lastDay ? `Due ${formatDate(employee.lastDay)}` : "", href: "/workspace/devices" });
}

export async function workplaceBlockers(client: PoolClient, employeeId: string) {
  const { rows: [held] } = await client.query<{ devices: string | null; apps: string | null }>(
    `SELECT (SELECT string_agg(d.asset_tag, ', ' ORDER BY lower(d.asset_tag)) FROM device_assignments a JOIN devices d ON d.id = a.device_id WHERE a.employee_id = $1 AND a.returned_at IS NULL) AS devices,
     (SELECT string_agg(p.name, ', ' ORDER BY lower(p.name)) FROM app_grants g JOIN apps p ON p.id = g.app_id WHERE g.employee_id = $1 AND g.state = 'granted') AS apps`, [employeeId],
  );
  return [held.devices && `Record the return of ${held.devices}.`, held.apps && `Record that access to ${held.apps} was removed.`].filter((line) => line !== null);
}

export async function upcomingRenewals(member: Member, days = 30) {
  if (member.role !== "admin") return [];
  const { rows } = await pool().query<{ id: string; name: string; renewsOn: string }>(
    `SELECT id, name, to_char(renews_on, 'YYYY-MM-DD') AS "renewsOn" FROM apps WHERE archived_at IS NULL AND renews_on <= current_date + $1::int ORDER BY renews_on, lower(name) LIMIT 20`, [days],
  );
  return rows;
}

export async function closeEquipmentRequests(client: PoolClient, member: Member, employeeId: string) {
  await client.query("UPDATE device_requests SET state = 'cancelled', closed_by = $2, closed_at = now() WHERE employee_id = $1 AND state = 'open'", [employeeId, member.id]);
  await client.query("UPDATE app_grants SET state = 'declined', closed_by = $2, closed_at = now() WHERE employee_id = $1 AND state IN ('requested', 'approved')", [employeeId, member.id]);
}
