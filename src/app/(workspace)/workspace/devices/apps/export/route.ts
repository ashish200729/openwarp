import { billingLabels, criticalityLabels, grantLabels } from "@/lib/domains/workplace";
import { toCsv, today } from "@/lib/operations";
import { exportApps } from "@/lib/server/devices";
import { apiMember } from "@/lib/server/member";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const member = await apiMember();
  if (!member) return new Response("Sign in to continue.", { status: 401, headers });
  if (member.role !== "admin") return new Response("Administrator access is required.", { status: 403, headers });
  const access = new URL(request.url).searchParams.get("list") === "access";
  try {
    const { apps, grants } = await exportApps(member);
    const rows = access ? [["App", "Person", "Email", "Role", "State", "Granted"], ...grants.map((grant) => [grant.appName, grant.employeeName, grant.email, grant.role, grantLabels[grant.state], grant.grantedAt?.toISOString().slice(0, 10) ?? ""])]
      : [["App", "Owner", "Criticality", "Cost per seat", "Billed", "Currency", "Seats", "People with access", "Renewal"], ...apps.map((app) => [app.name, app.owner ?? "", criticalityLabels[app.criticality], (app.seatCostCents / 100).toFixed(2), billingLabels[app.billing], app.currency, app.seats === null ? "" : String(app.seats), String(app.used), app.renewsOn ?? ""])];
    return new Response(toCsv(rows), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="openwarp-${access ? "app-access" : "apps"}-${today()}.csv"` } });
  } catch (error) {
    console.error("OpenWarp app export failed", error instanceof Error ? error.name : "unknown");
    return new Response("The export is unavailable right now.", { status: 503, headers });
  }
}
