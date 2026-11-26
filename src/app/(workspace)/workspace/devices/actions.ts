"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/workspace/action-state";
import {
  appDefaultFields, appFields, appGrantFields, appRequestFields, attestationFields, closeRepairFields, deviceAssignFields, deviceCommandFields, deviceFields, deviceRequestCommandFields, deviceRequestFields,
  deviceReturnFields, deviceReturnRequestFields, grantCommandFields, idField, repairFields, workplaceSettingsFields,
} from "@/lib/domains/workplace";
import {
  addAppDefault, archiveApp, askForReturn, assignDevice, attestDevice, checkDeviceImport, closeDeviceRequest, closeRepair, commandGrant, confirmDevice, grantApp, importDevices, removeAppDefault, reportRepair,
  requestApp, requestDevice, returnDevice, saveApp, saveDevice, saveWorkplaceSettings, sendBackDevice, setDeviceStatus, type ImportIssue,
} from "@/lib/server/devices";
import { requireAdmin, requireMember } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { failed } from "@/lib/server/write";

export async function saveDeviceAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, deviceFields, data, async (member, input) => ({ redirect: `/workspace/devices/${await saveDevice(member, input)}?saved=${input.id ? "changed" : "added"}` }));
}

export async function deviceStatusAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, deviceCommandFields, data, (member, input) => setDeviceStatus(member, input));
}

export async function assignDeviceAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, deviceAssignFields, data, (member, input) => assignDevice(member, input));
}

export async function askForReturnAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, deviceReturnRequestFields, data, async (member, input) => { await askForReturn(member, input); return "Return requested."; });
}

export async function returnDeviceAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, deviceReturnFields, data, (member, input) => returnDevice(member, input));
}

export async function confirmDeviceAction(_state: ActionState, data: FormData) {
  return perform(requireMember, idField, data, (member, { id }) => confirmDevice(member, id));
}

export async function sendBackAction(_state: ActionState, data: FormData) {
  return perform(requireMember, idField, data, (member, { id }) => sendBackDevice(member, id));
}

export async function attestAction(_state: ActionState, data: FormData) {
  return perform(requireMember, attestationFields, data, (member, input) => attestDevice(member, input));
}

export async function requestDeviceAction(_state: ActionState, data: FormData) {
  return perform(requireMember, deviceRequestFields, data, async (member, input) => { await requestDevice(member, input); return { redirect: "/workspace/devices?saved=requested" }; });
}

export async function deviceRequestAction(_state: ActionState, data: FormData) {
  return perform(requireMember, deviceRequestCommandFields, data, (member, input) => closeDeviceRequest(member, input));
}

export async function reportRepairAction(_state: ActionState, data: FormData) {
  return perform(requireMember, repairFields, data, async (member, input) => { await reportRepair(member, input); return "Problem reported."; });
}

export async function closeRepairAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, closeRepairFields, data, (member, input) => closeRepair(member, input));
}

export type DeviceImportState = ActionState & { plan?: { count: number; problems: ImportIssue[] } };

export async function importDevicesAction(_state: DeviceImportState, data: FormData): Promise<DeviceImportState> {
  const member = await requireAdmin();
  const text = data.get("csv");
  if (typeof text !== "string" || !text.trim()) return { error: "Choose a CSV file." };
  if (Buffer.byteLength(text, "utf8") > 1_000_000) return { error: "Choose a file of 1 MB or less." };
  let imported = 0;
  try {
    if (data.get("operation") !== "import") return { plan: await checkDeviceImport(text) };
    imported = await importDevices(member, text);
  } catch (error) {
    return failed(error);
  }
  revalidatePath("/workspace", "layout");
  redirect(`/workspace/devices?imported=${imported}`);
}

export async function saveAppAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, appFields, data, async (member, input) => ({ redirect: `/workspace/devices/apps/${await saveApp(member, input)}?saved=${input.id ? "changed" : "added"}` }));
}

export async function archiveAppAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, idField, data, async (member, { id }) => { await archiveApp(member, id); return { redirect: "/workspace/devices/apps?saved=archived" }; });
}

export async function requestAppAction(_state: ActionState, data: FormData) {
  return perform(requireMember, appRequestFields, data, async (member, input) => { await requestApp(member, input); return { redirect: "/workspace/devices/apps?saved=requested" }; });
}

export async function grantAppAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, appGrantFields, data, async (member, input) => { await grantApp(member, input); return "Access recorded."; });
}

export async function grantCommandAction(_state: ActionState, data: FormData) {
  return perform(requireMember, grantCommandFields, data, (member, input) => commandGrant(member, input));
}

export async function addAppDefaultAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, appDefaultFields, data, async (member, input) => { await addAppDefault(member, input); return "Default added."; });
}

export async function removeAppDefaultAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, idField, data, (member, { id }) => removeAppDefault(member, id));
}

export async function saveWorkplaceSettingsAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, workplaceSettingsFields, data, (member, input) => saveWorkplaceSettings(member, input));
}
