import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { entryCookie, entryDestination } from "@/lib/server/entry";
import { requireMember } from "@/lib/server/member";
import { workspaceOrigin } from "@/lib/server/platform-settings";

export async function GET() {
  const member = await requireMember();
  const path = (await cookies()).get(entryCookie)?.value;
  const response = NextResponse.redirect(new URL(await entryDestination(member, path), workspaceOrigin()), 303);
  response.cookies.delete(entryCookie);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
