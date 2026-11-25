import { employmentLabels, employeeFilters, statusLabels } from "@/lib/people";
import { currentMember } from "@/lib/server/member";
import { exportEmployees, PeopleError } from "@/lib/server/people-mutations";

function csvCell(value: string) {
  const safe = /^[\u0000-\u0020]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const member = await currentMember();
  if (!member) return new Response("Sign in to continue.", { status: 401, headers: privateHeaders });
  if (member.role !== "admin") return new Response("Administrator access is required.", { status: 403, headers: privateHeaders });

  const filters = employeeFilters(Object.fromEntries(new URL(request.url).searchParams), true);
  try {
    const employees = await exportEmployees(member, filters);
    const rows = [["First name", "Last name", "Work email", "Job title", "Team", "Manager", "Employment type", "Status", "Start date", "Last day", "Location"]];
    for (const employee of employees) {
      rows.push([employee.firstName, employee.lastName, employee.email, employee.title, employee.teamName ?? "", employee.managerName ?? "",
        employmentLabels[employee.employmentType], statusLabels[employee.status], employee.hireDate, employee.lastDay ?? "", employee.location]);
    }
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, { headers: { ...privateHeaders, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="openwarp-people-${date}.csv"` } });
  } catch (error) {
    if (error instanceof PeopleError) return new Response(error.message, { status: error.message.startsWith("Administrator") ? 403 : 422, headers: privateHeaders });
    console.error("OpenWarp CSV export failed", error instanceof Error ? error.name : "unknown");
    return new Response("The export is unavailable right now.", { status: 503, headers: privateHeaders });
  }
}
