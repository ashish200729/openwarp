import Link from "next/link";
import type { ReactNode } from "react";
import { Brand, repositoryUrl } from "@/components/brand";
import { ArrowUpRightIcon, PlusIcon } from "@/components/icons";
import { HeroField } from "@/components/marketing/hero-field";
import { ModuleTabs } from "@/components/marketing/module-tabs";
import { Screen } from "@/components/marketing/screen";
import { SetupSteps } from "@/components/marketing/setup-steps";
import { SiteHeader, siteLinks } from "@/components/marketing/site-header";
import { largeButton, primaryButton, secondaryButton, textLink } from "@/components/ui";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const modules = [
  { id: "people", title: "Directory", description: "Search by name, role, team or location. Bring people in from a CSV file, and take any view back out as one.", alt: "The OpenWarp people directory with sample employees, teams and statuses" },
  { id: "time-off", title: "Time off", description: "People request days against their balance. Their manager approves, and the shared calendar shows who’s away without showing why.", alt: "Time off balances, requests waiting for approval and a month calendar" },
  { id: "timesheets", title: "Timesheets", description: "Clock in from any device, or enter hours by hand. Weeks are split into regular time and overtime, approved, and carried into pay.", alt: "A team’s timesheets for one week with daily hours" },
  { id: "pay", title: "Pay runs", description: "Gross to net with the deductions and taxes you configure, benefits, approved hours and expenses. Approve it, then download the bank file, the journal and the payslips.", alt: "A draft pay run with totals and a line for each person" },
  { id: "devices", title: "Devices", description: "Who has which laptop, when its warranty ends and whether its owner has confirmed it’s encrypted. Leavers can’t be archived with equipment outstanding.", alt: "The device inventory with assignments and warranty dates" },
  { id: "reports", title: "Reports", description: "Headcount, turnover, tenure, time off owed and plan against actual, worked out from the records already on file.", alt: "Headcount, turnover and tenure reports" },
];
const spec = [
  { title: "People", items: ["Profiles, custom fields and emergency contacts", "Teams, reporting lines and org chart", "Job, pay and change history", "Self-service onboarding portal", "Offboarding and rehire checklists", "Announcements"] },
  { title: "Time", items: ["Clock in and out with breaks", "Timesheets, overtime and approvals", "Shift schedules", "Leave accrual, carryover and holidays", "Team coverage calendar"] },
  { title: "Pay and benefits", items: ["Pay runs, off-cycle runs and corrections", "Deductions, taxes and caps you configure", "Payslips with year to date", "NACHA, SEPA and journal files", "Expenses and contractor invoices", "Benefit plans, enrollment and dependents"] },
  { title: "Workplace", items: ["Documents with versions and expiry", "E-signatures with a tamper-evident certificate", "Devices and app access", "Training with quizzes and certificates", "Compliance calendar and notices"] },
  { title: "Security", items: ["Two-factor sign-in and backup codes", "Single sign-on with OpenID Connect", "Administrator, manager and member access", "Bank and identity data sealed at rest", "Activity history the app can’t rewrite"] },
  { title: "Connections", items: ["REST API with scoped tokens", "MCP server for AI assistants", "Signed webhooks with retries", "Scheduled and event routines", "Email notifications over your SMTP"] },
];
const excluded = ["Filing or remitting taxes", "sending money", "insurance brokerage and carrier sync", "remote control of devices", "creating accounts in other systems"];
const questions: { question: string; answer: ReactNode }[] = [
  { question: "Is OpenWarp connected to Warp, the payroll company?", answer: "No. OpenWarp is an independent open-source project. Warp doesn’t make, sponsor or endorse it." },
  { question: "Does it run payroll?", answer: "It calculates gross to net from the rates you enter and produces payslips, a bank file and a journal. You’re responsible for the rates, and you or your provider file returns, remit taxes and upload the bank file." },
  { question: "Where does employee data live?", answer: "In the PostgreSQL database you run, including uploaded files. Bank details, identity numbers and two-factor secrets are encrypted before they’re stored, with a key you hold." },
  { question: "Who can see pay?", answer: "The person it belongs to and administrators. Managers approve time, time off and expenses for their direct reports, and they don’t see pay, bank or benefit details." },
  { question: "Can an AI assistant use it?", answer: "Yes. The MCP server and the API use the same scoped tokens. Reading pay needs its own scope, and every change is recorded in the activity history." },
  { question: "How do backups and upgrades work?", answer: <>Back up with <code className="font-mono text-[0.92em]">pg_dump</code>, then rebuild on the new revision. Migrations run under a lock and stop if their history was edited. The <a className={cn(textLink, "underline")} href={`${repositoryUrl}/blob/main/docs/operations.md`}>operations guide</a> has the steps.</> },
  { question: "What does the license ask of me?", answer: "You can use and change OpenWarp under AGPL-3.0. If you let other people use a modified version over a network, you need to offer them its source." },
];
const heading = "text-[clamp(1.75rem,3.4vw,2.25rem)] leading-[1.12] font-medium tracking-[-0.022em] text-balance";

export default function HomePage() {
  return (
    <div className="bg-surface">
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        <section className="relative isolate overflow-hidden">
          <HeroField className="hero-field h-[52rem]" level={0.37} />
          <div className="mx-auto max-w-[74rem] px-5 pt-14 pb-16 sm:px-8 sm:pt-20 lg:pt-24">
            <h1 className="text-[clamp(2.6rem,6.2vw,4.5rem)] leading-[1.02] font-medium tracking-[-0.03em]">The people system <br className="hidden sm:block" />you own.</h1>
            <p className="mt-5 max-w-[46ch] text-lg leading-[1.55] text-pretty text-muted">Directory, time, pay, benefits, documents and devices in one workspace, on a server you control. Open source, with no per-employee fee.</p>
            <div className="mt-8 flex flex-wrap items-center gap-2.5">
              <a href="#self-host" className={cn(primaryButton, largeButton)}>Self-host OpenWarp</a>
              <a href={repositoryUrl} className={cn(secondaryButton, largeButton)}>View the source</a>
            </div>
            <figure className="mt-36 sm:mt-40 lg:mt-32"><Screen name="home" alt="The OpenWarp home screen with sample data: headcount, approvals waiting, who is away and the directory" className="shadow-window" /><figcaption className="mt-3 text-[13px] text-muted">The OpenWarp workspace with sample data.</figcaption></figure>
          </div>
        </section>

        <section id="product" className="mx-auto max-w-[74rem] px-5 pt-16 sm:px-8 sm:pt-24">
          <h2 className={cn(heading, "mb-8 max-w-[24ch] sm:mb-12")}>The work between someone’s first day and their last.</h2>
          <ModuleTabs label="Product areas" modules={modules.map(({ alt, ...module }) => ({ ...module, screen: <Screen name={module.id} alt={alt} /> }))} />
        </section>

        <section id="scope" className="mx-auto max-w-[74rem] px-5 pt-24 sm:px-8 sm:pt-32">
          <h2 className={heading}>What’s in v0.3</h2>
          <div className="mt-8 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {spec.map((group) => <div key={group.title}><h3 className="border-b border-foreground pb-2 text-[15px] font-semibold">{group.title}</h3><ul>{group.items.map((item) => <li key={item} className="border-b border-line py-2.5 text-[15px] leading-snug text-pretty">{item}</li>)}</ul></div>)}
          </div>
          <div className="mt-10 grid gap-x-10 gap-y-2 text-[15px] leading-relaxed lg:grid-cols-3"><h3 className="font-semibold">Not included</h3><p className="text-pretty text-muted lg:col-span-2">{excluded.slice(0, -1).join(", ")} and {excluded.at(-1)}. If you need these today, keep the provider you have and use OpenWarp as the record behind it.</p></div>
        </section>

        <section id="self-host" className="mt-24 border-y border-line bg-background sm:mt-32">
          <div className="mx-auto grid max-w-[74rem] items-start gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-12">
            <div><h2 className={heading}>Three steps to a running workspace</h2>
              <p className="mt-4 text-[15px] leading-relaxed text-pretty text-muted">You need Docker Engine with Compose v2. Compose starts PostgreSQL, applies the migrations and runs the app as a non-root user. Then create your first administrator and sign in.</p>
              <a href={`${repositoryUrl}#self-host`} className={cn(textLink, "mt-4 inline-flex min-h-11 items-center gap-1 text-[15px] font-medium")}>Full setup guide <ArrowUpRightIcon aria-hidden="true" size={15} /></a></div>
            <SetupSteps />
          </div>
        </section>

        <section id="questions" className="mx-auto grid max-w-[74rem] gap-8 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-12">
          <h2 className={heading}>Questions</h2>
          <div className="max-w-3xl border-t border-line">
            {questions.map(({ question, answer }) => <details key={question} className="group border-b border-line">
              <summary className="flex min-h-14 items-center justify-between gap-4 rounded py-3.5 text-[17px] font-medium">{question}<PlusIcon aria-hidden="true" size={16} className="shrink-0 text-hint group-open:rotate-45" /></summary>
              <p className="max-w-[62ch] pb-5 text-base leading-relaxed text-pretty text-muted">{answer}</p>
            </details>)}
          </div>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[74rem] flex-wrap items-center justify-between gap-x-10 gap-y-2 px-5 py-6 sm:px-8">
          <Brand />
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 text-sm text-muted">
            {siteLinks.map(({ label, href }) => <a key={href} href={href} className="inline-flex min-h-11 items-center rounded hover:text-foreground">{label}</a>)}
            <a href={`${repositoryUrl}/blob/main/LICENSE`} className="inline-flex min-h-11 items-center rounded hover:text-foreground">License</a>
            <Link href="/login" className="inline-flex min-h-11 items-center rounded hover:text-foreground">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
