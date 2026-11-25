import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown, UserRound } from "lucide-react";
import { Brand } from "@/components/brand";
import { textButton } from "@/components/ui";
import { SignOutButton } from "@/components/workspace/auth-controls";
import { WorkspaceNavigation } from "@/components/workspace/navigation";
import { initials } from "@/lib/people";
import { requireMember, workspaceName } from "@/lib/server/member";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const member = await requireMember();
  return (
    <div className="mx-auto min-h-dvh max-w-[108rem] lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-col border-b border-line bg-panel px-4 py-2 lg:sticky lg:top-0 lg:h-dvh lg:border-r lg:border-b-0 lg:px-4 lg:py-5">
        <div className="flex min-w-0 items-center justify-between gap-3 lg:mb-8 lg:px-1">
          <Brand href="/" />
          <details className="group relative lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-1 text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="grid size-8 place-items-center rounded-md bg-accent/12 font-mono text-xs text-accent">{initials(member.name)}</span>
              <span className="text-sm">Account</span>
              <ChevronDown aria-hidden="true" size={14} />
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-52 rounded-lg border border-control bg-panel p-2 shadow-xl">
              <p className="px-3 py-2 text-sm wrap-anywhere">{member.name}</p>
              <Link href="/workspace/account" className={`${textButton} w-full justify-start`}><UserRound aria-hidden="true" size={16} /> My account</Link>
              <SignOutButton />
            </div>
          </details>
        </div>
        <span className="mb-2 hidden px-3 font-mono text-[10px] font-medium tracking-[0.16em] text-hint uppercase lg:block">Workspace</span>
        <WorkspaceNavigation canManage={member.role === "admin"} />
        <div className="mt-auto hidden border-t border-line pt-4 lg:block">
          <div className="mb-2 flex min-w-0 items-center gap-2.5 px-2">
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-md bg-accent/12 font-mono text-xs text-accent">{initials(member.name)}</span>
            <div className="min-w-0"><p className="truncate text-sm font-medium" title={member.name}>{member.name}</p><p className="text-xs text-muted">{member.role === "admin" ? "Administrator" : "Viewer"}</p></div>
          </div>
          <Link href="/workspace/account" className={`${textButton} w-full justify-start`}><UserRound aria-hidden="true" size={16} /> My account</Link>
          <SignOutButton />
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex min-h-14 items-center gap-2.5 border-b border-line px-4 py-2 text-sm text-muted sm:px-7 lg:px-9">
          <span aria-hidden="true" className="pixel-fill size-2.5 shrink-0 [--pixel-size:5px] [--pixel:var(--accent)]" />
          <span className="wrap-anywhere">{workspaceName()}</span>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto max-w-[82rem] px-4 py-7 sm:px-7 sm:py-9 lg:px-9 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
