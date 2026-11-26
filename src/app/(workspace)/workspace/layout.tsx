import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { BellIcon, CaretDownIcon, UserCircleIcon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { textButton } from "@/components/ui";
import { SignOutButton } from "@/components/workspace/auth-controls";
import { WorkspaceNavigation } from "@/components/workspace/navigation";
import { Avatar } from "@/components/workspace/presentation";
import { SearchButton, WorkspaceSearch } from "@/components/workspace/search";
import { requireMember, workspaceName } from "@/lib/server/member";
import { pendingExpenses } from "@/lib/server/expenses";
import { unreadNotifications } from "@/lib/server/notify";
import { pendingTimesheets } from "@/lib/server/time-module";
import { pendingTimeOff } from "@/lib/server/time-off";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const member = await requireMember();
  const canManage = member.role === "admin";
  const decides = canManage || member.managesPeople;
  const [timeOff, expenses, timesheets, unread] = await Promise.all([decides ? pendingTimeOff(member) : [], decides ? pendingExpenses(member) : [], decides ? pendingTimesheets(member) : 0, unreadNotifications(member)]);
  const role = canManage ? "Administrator" : "Member";
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[228px_minmax(0,1fr)]">
      <aside className="print:hidden sticky top-0 z-20 flex min-w-0 flex-col border-b border-line bg-background px-4 lg:h-dvh lg:border-r lg:border-b-0 lg:px-3 lg:py-3">
        <div className="flex min-w-0 items-center justify-between gap-1 lg:mb-2 lg:px-2.5">
          <Brand href="/workspace" />
          <div className="flex items-center lg:hidden">
            <SearchButton compact />
            <details className="group relative">
              <summary className="flex min-h-11 items-center gap-2 rounded-[7px] px-1.5 text-muted hover:text-foreground">
                <Avatar name={member.name} size="small" />
                <span className="text-sm">Account</span>
                <CaretDownIcon aria-hidden="true" size={12} />
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-60 rounded-[10px] border border-line-strong bg-panel p-1.5 shadow-float">
                <div className="px-3 py-2"><p className="text-sm font-medium wrap-anywhere">{member.name}</p><p className="text-[13px] text-muted">{role}</p></div>
                <Link href="/workspace/account" className={`${textButton} w-full justify-start`}><UserCircleIcon aria-hidden="true" size={17} /> My account</Link>
                <SignOutButton />
              </div>
            </details>
          </div>
        </div>
        <div className="hidden lg:block"><SearchButton /></div>
        <div className="scroll-quiet lg:-mx-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-1 lg:pb-3"><WorkspaceNavigation canManage={canManage} employeeId={member.employeeId} counts={{ timeOff: timeOff.length, expenses: expenses.length, timesheets }} /></div>
        <div className="hidden border-t border-line pt-2 lg:block">
          <div className="mb-1 flex min-w-0 items-center gap-2.5 px-2.5 py-1">
            <Avatar name={member.name} />
            <div className="min-w-0"><p className="truncate text-sm font-medium" title={member.name}>{member.name}</p><p className="text-[13px] text-muted">{role}</p></div>
          </div>
          <div className="flex gap-0.5 [&>*]:min-w-0 [&>*]:flex-1">
            <Link href="/workspace/account" className={`${textButton} px-2! text-[13px]!`}>My account</Link>
            <SignOutButton compact />
          </div>
        </div>
      </aside>
      <div className="min-w-0 bg-surface pb-[calc(4rem+env(safe-area-inset-bottom))] lg:min-h-dvh lg:pb-0">
        <header className="print:hidden flex min-h-12 items-center justify-between gap-3 border-b border-line py-1 pr-2 pl-4 text-sm text-muted sm:pr-5 sm:pl-7 lg:pl-10">
          <span className="min-w-0 wrap-anywhere">{workspaceName()}</span>
          <span className="flex items-center">
            <Link href="/workspace/notifications" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} title="Notifications" className="relative grid size-11 place-items-center rounded-[7px] text-muted hover:bg-raised hover:text-foreground pointer-fine:size-9"><BellIcon aria-hidden="true" size={17} />{unread > 0 && <span aria-hidden="true" className="absolute top-1.5 right-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-ink pointer-fine:top-0 pointer-fine:right-0">{unread > 99 ? "99" : unread}</span>}</Link>
            <ThemeToggle />
          </span>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto max-w-[76rem] px-4 py-6 sm:px-7 sm:py-8 lg:px-10">{children}</main>
      </div>
      <WorkspaceSearch canManage={canManage} />
    </div>
  );
}
