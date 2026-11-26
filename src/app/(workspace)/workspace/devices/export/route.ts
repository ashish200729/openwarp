import { conditionLabels, deviceKindLabels, deviceStatusLabels } from "@/lib/domains/workplace";
import { toCsv, today } from "@/lib/operations";
import { deviceFilters, exportDevices } from "@/lib/server/devices";
import { apiMember } from "@/lib/server/member";
import { PeopleError } from "@/lib/server/write";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const member = await apiMember();
  if (!member) return new Response("Sign in to continue.", { status: 401, headers });
  if (member.role !== "admin") return new Response("Administrator access is required.", { status: 403, headers });
  try {
    const devices = await exportDevices(member, deviceFilters(Object.fromEntries(new URL(request.url).searchParams)));
    const rows = [["Asset tag", "Type", "Make", "Model", "Serial", "Status", "With", "Condition", "Purchase date", "Cost", "Currency", "Warranty end", "Notes"], ...devices.map((device) => [
      device.assetTag, deviceKindLabels[device.kind], device.make, device.model, device.serial, deviceStatusLabels[device.status], device.holder ?? "", conditionLabels[device.condition], device.purchasedOn ?? "",
      device.costCents === null ? "" : (device.costCents / 100).toFixed(2), device.currency, device.warrantyEndsOn ?? "", device.notes,
    ])];
    return new Response(toCsv(rows), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="openwarp-devices-${today()}.csv"` } });
  } catch (error) {
    if (error instanceof PeopleError) return new Response(error.message, { status: 422, headers });
    console.error("OpenWarp device export failed", error instanceof Error ? error.name : "unknown");
    return new Response("The export is unavailable right now.", { status: 503, headers });
  }
}
