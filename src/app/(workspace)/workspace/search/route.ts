import { searchWorkspace } from "@/lib/server/insights";
import { apiMember } from "@/lib/server/member";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const member = await apiMember();
  if (!member) return Response.json([], { status: 401, headers });
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (query.length < 2) return Response.json([], { headers });
  try {
    const rows = await searchWorkspace(member, query);
    return Response.json(rows.map(({ kind, id, label, detail }) => ({ key: `${kind}-${id}`, label, detail, href: kind === "person" ? `/workspace/people/${id}` : `/workspace/people?team=${id}` })), { headers });
  } catch (error) {
    console.error("OpenWarp search failed", error instanceof Error ? error.name : "unknown");
    return Response.json([], { status: 503, headers });
  }
}
