import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Brand, repositoryUrl } from "@/components/brand";
import { panelStyle } from "@/components/ui";
import { SignInForm } from "@/components/workspace/auth-controls";
import { hasWorkspaceConfig } from "@/lib/server/auth";
import { currentMember, workspaceName } from "@/lib/server/member";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const configured = hasWorkspaceConfig();
  if (configured && await currentMember()) redirect("/workspace");

  return (
    <div className="relative grid min-h-dvh grid-rows-[auto_1fr]">
      <div className="mx-auto flex min-h-16 w-full max-w-[80rem] items-center justify-between gap-3 border-b border-line px-5 sm:px-8">
        <Brand />
        <Link href="/" className="flex min-h-11 items-center gap-2 rounded text-sm text-muted hover:text-foreground"><ArrowLeft aria-hidden="true" size={15} /> Home</Link>
      </div>
      <main id="main" tabIndex={-1} className="relative isolate grid place-items-center overflow-hidden px-5 py-12">
        <div aria-hidden="true" className="pixel-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,#000,transparent_65%)] [--pixel-size:13px] [--pixel:#34304a]" />
        <section className={`${panelStyle} w-full max-w-md p-6 sm:p-8`}>
          <span aria-hidden="true" className="pixel-fill block size-6 [--pixel-size:8px] [--pixel:var(--accent)]" />
          <h1 className="mt-4 text-3xl font-medium tracking-[-0.055em]">Sign in to OpenWarp</h1>
          {configured ? <>
            <p className="mt-2 wrap-anywhere text-sm text-muted">{workspaceName()}</p>
            <SignInForm />
            <p className="mt-5 text-xs leading-relaxed text-muted">Need access or a password reset? Contact your workspace administrator.</p>
          </> : <>
            <p className="mt-3 text-sm leading-relaxed text-muted">Set up the database and create an administrator account to open your workspace.</p>
            <a className="mt-4 inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4" href={`${repositoryUrl}#self-host`}>Read the self-hosting guide</a>
          </>}
        </section>
      </main>
    </div>
  );
}
