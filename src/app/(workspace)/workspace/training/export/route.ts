import { z } from "zod";
import { toCsv, today } from "@/lib/operations";
import { apiMember } from "@/lib/server/member";
import { exportTraining } from "@/lib/server/training";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const member = await apiMember();
  if (!member) return new Response("Sign in to continue.", { status: 401, headers });
  if (member.role !== "admin") return new Response("Administrator access is required.", { status: 403, headers });
  const course = new URL(request.url).searchParams.get("course");
  if (course && !z.uuid().safeParse(course).success) return new Response("Not found.", { status: 404, headers });
  try {
    const rows = await exportTraining(member, course);
    const status = (row: (typeof rows)[number]) => row.state === "cancelled" ? "Cancelled" : row.state === "completed" ? "Completed" : row.upcoming ? "Not open yet" : row.overdue ? "Overdue" : "Open";
    return new Response(toCsv([["Course", "Person", "Team", "Status", "Opens", "Due", "Lessons done", "Lessons", "Attempts", "Score %", "Completed", "Valid until"], ...rows.map((row) => [
      row.title, row.employeeName, row.teamName ?? "", status(row), row.opensOn, row.dueOn ?? "", String(row.lessonsDone), String(row.lessons), String(row.attempts), row.scorePercent === null ? "" : String(row.scorePercent), row.completedOn ?? "", row.expiresOn ?? "",
    ])]), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="openwarp-training-${today()}.csv"` } });
  } catch (error) {
    console.error("OpenWarp training export failed", error instanceof Error ? error.name : "unknown");
    return new Response("The export is unavailable right now.", { status: 503, headers });
  }
}
