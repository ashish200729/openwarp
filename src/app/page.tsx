import Link from "next/link";
import type { ReactNode } from "react";
import { Brand, repositoryUrl } from "@/components/brand";
import {
  ArrowRightIcon, ArrowUpRightIcon, ClockIcon, CodeIcon, DatabaseIcon, GithubLogoIcon, HandCoinsIcon, LaptopIcon, MoneyIcon, PlugsIcon, PlusIcon, ShieldCheckIcon, UsersThreeIcon,
  type Icon,
} from "@/components/icons";
import { HeroField } from "@/components/marketing/hero-field";
import { ModuleTabs } from "@/components/marketing/module-tabs";
import { Screen } from "@/components/marketing/screen";
import { SetupSteps } from "@/components/marketing/setup-steps";
import { SiteHeader, siteLinks } from "@/components/marketing/site-header";
import { largeButton, primaryButton, secondaryButton, textLink } from "@/components/ui";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const principles: { icon: Icon; title: string; description: string }[] = [
  { icon: DatabaseIcon, title: "On your server", description: "Records and uploads live in the PostgreSQL database you run. Bank and identity data are sealed with a key you hold." },
  { icon: HandCoinsIcon, title: "No per-employee fee", description: "Add everyone, contractors included. What you pay for is the server it runs on." },
  { icon: CodeIcon, title: "Open source", description: "Read the code, change what you need and run it under AGPL-3.0." },
  { icon: PlugsIcon, title: "Open to your tools", description: "A REST API, an MCP server for AI assistants and signed webhooks, all behind scoped tokens." },
];
const modules = [
  { id: "people", title: "Directory", description: "Search by name, role, team or location. Bring people in from a CSV file, and take any view back out as one.", alt: "The OpenWarp people directory with sample employees, teams and statuses" },
  { id: "time-off", title: "Time off", description: "People request days against their balance. Their manager approves, and the shared calendar shows who’s away without showing why.", alt: "Time off balances, requests waiting for approval and a month calendar" },
  { id: "timesheets", title: "Timesheets", description: "Clock in from any device, or enter hours by hand. Weeks are split into regular time and overtime, approved, and carried into pay.", alt: "A team’s timesheets for one week with daily hours" },
  { id: "pay", title: "Pay runs", description: "Gross to net with the deductions and taxes you configure, benefits, approved hours and expenses. Approve it, then download the bank file, the journal and the payslips.", alt: "A draft pay run with totals and a line for each person" },
  { id: "devices", title: "Devices", description: "Who has which laptop, when its warranty ends and whether its owner has confirmed it’s encrypted. Leavers can’t be archived with equipment outstanding.", alt: "The device inventory with assignments and warranty dates" },
  { id: "reports", title: "Reports", description: "Headcount, turnover, tenure, time off owed and plan against actual, worked out from the records already on file.", alt: "Headcount, turnover and tenure reports" },
];
const spec: { icon: Icon; title: string; items: string[] }[] = [
  { icon: UsersThreeIcon, title: "People", items: ["Profiles, custom fields and emergency contacts", "Teams, reporting lines and org chart", "Job, pay and change history", "Self-service onboarding portal", "Offboarding and rehire checklists", "Announcements"] },
  { icon: ClockIcon, title: "Time", items: ["Clock in and out with breaks", "Timesheets, overtime and approvals", "Shift schedules", "Leave accrual, carryover and holidays", "Team coverage calendar"] },
  { icon: MoneyIcon, title: "Pay and benefits", items: ["Pay runs, off-cycle runs and corrections", "Deductions, taxes and caps you configure", "Payslips with year to date", "NACHA, SEPA and journal files", "Expenses and contractor invoices", "Benefit plans, enrollment and dependents"] },
  { icon: LaptopIcon, title: "Workplace", items: ["Documents with versions and expiry", "E-signatures with a tamper-evident certificate", "Devices and app access", "Training with quizzes and certificates", "Compliance calendar and notices"] },
  { icon: ShieldCheckIcon, title: "Security", items: ["Two-factor sign-in and backup codes", "Single sign-on with OpenID Connect", "Administrator, manager and member access", "Bank and identity data sealed at rest", "Activity history the app can’t rewrite"] },
  { icon: PlugsIcon, title: "Connections", items: ["REST API with scoped tokens", "MCP server for AI assistants", "Signed webhooks with retries", "Scheduled and event routines", "Email notifications over your SMTP"] },
];
const excluded = ["Filing or remitting taxes", "Sending money", "Insurance brokerage and carrier sync", "Remote control of devices", "Creating accounts in other systems"];
const questions: { question: string; answer: ReactNode }[] = [
  { question: "Is OpenWarp connected to Warp, the payroll company?", answer: "No. OpenWarp is an independent open-source project. Warp doesn’t make, sponsor or endorse it." },
  { question: "Does it run payroll?", answer: "It calculates gross to net from the rates you enter and produces payslips, a bank file and a journal. You’re responsible for the rates, and you or your provider file returns, remit taxes and upload the bank file." },
  { question: "Where does employee data live?", answer: "In the PostgreSQL database you run, including uploaded files. Bank details, identity numbers and two-factor secrets are encrypted before they’re stored, with a key you hold." },
  { question: "Who can see pay?", answer: "The person it belongs to and administrators. Managers approve time, time off and expenses for their direct reports, and they don’t see pay, bank or benefit details." },
  { question: "Can an AI assistant use it?", answer: "Yes. The MCP server and the API use the same scoped tokens. Reading pay needs its own scope, and every change is recorded in the activity history." },
  { question: "How do backups and upgrades work?", answer: <>Back up with <code className="font-mono text-[0.92em]">pg_dump</code>, then rebuild on the new revision. Migrations run under a lock and stop if their history was edited. The <a className={cn(textLink, "underline")} href={`${repositoryUrl}/blob/main/docs/operations.md`}>operations guide</a> has the steps.</> },
  { question: "What does the license ask of me?", answer: "You can use and change OpenWarp under AGPL-3.0. If you let other people use a modified version over a network, you need to offer them its source." },
];
const footerGroups: { title: string; links: { label: string; href: string; internal?: boolean }[] }[] = [
  { title: "OpenWarp", links: siteLinks.filter(({ href }) => href.startsWith("#")) },
  {
    title: "Resources",
    links: [
      { label: "Source code", href: repositoryUrl },
      { label: "Setup guide", href: `${repositoryUrl}#self-host` },
      { label: "Operations guide", href: `${repositoryUrl}/blob/main/docs/operations.md` },
      { label: "Report an issue", href: `${repositoryUrl}/issues` },
      { label: "License", href: `${repositoryUrl}/blob/main/LICENSE` },
    ],
  },
  { title: "Workspace", links: [{ label: "Get started", href: "/get-started", internal: true }, { label: "Sign in", href: "/login", internal: true }] },
];

const container = "mx-auto max-w-[74rem] px-5 sm:px-8";
const heading = "text-[clamp(1.75rem,3.4vw,2.25rem)] leading-[1.12] font-medium tracking-[-0.022em] text-balance";
const lead = "mt-4 max-w-[52ch] text-base leading-relaxed text-pretty text-muted";
const externalLink = cn(textLink, "inline-flex min-h-11 items-center gap-1 text-[15px] font-medium no-underline hover:underline");
// Sections that pair a heading column with content share the product tabs’ grid.
const split = "grid items-start gap-x-12 gap-y-10 lg:grid-cols-[17rem_minmax(0,1fr)]";
const footerLink = "inline-flex min-h-8 items-center rounded text-sm text-muted transition-colors hover:text-foreground motion-reduce:transition-none";

export default function HomePage() {
  return (
    <div className="bg-surface">
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        {/* The hero runs up under the transparent header (h-14). */}
        <section className="relative isolate -mt-14 overflow-hidden">
          <HeroField className="hero-field h-[55.5rem]" level={0.37} showControl={false} />
          <div className={cn(container, "pt-26 pb-14 sm:pt-34 lg:pt-36")}>
            <a href={repositoryUrl} className="group inline-flex min-h-9 items-center gap-2 rounded-full border border-line bg-surface/70 py-1 pr-3 pl-2.5 text-[13px] text-muted backdrop-blur-sm transition-colors hover:border-line-strong hover:text-foreground motion-reduce:transition-none">
              <GithubLogoIcon aria-hidden="true" size={15} weight="fill" className="text-foreground" />
              <span>Open source under AGPL-3.0</span>
              <span aria-hidden="true" className="h-3.5 w-px bg-line-strong" />
              <span className="font-medium text-foreground">v0.3</span>
            </a>
            <h1 className="mt-6 text-[clamp(2.6rem,6.2vw,4.5rem)] leading-[1.02] font-medium tracking-[-0.03em]">The people system <br className="hidden sm:block" />you own.</h1>
            <p className="mt-5 max-w-[46ch] text-lg leading-[1.55] text-pretty text-muted">Directory, time, pay, benefits, documents and devices in one workspace, on a server you control. Open source, with no per-employee fee.</p>
            <div className="mt-8 flex flex-wrap items-center gap-2.5">
              <a href="#self-host" className={cn(primaryButton, largeButton)}>Self-host OpenWarp</a>
              <a href={repositoryUrl} className={cn(secondaryButton, largeButton)}><GithubLogoIcon aria-hidden="true" size={17} />View the source</a>
            </div>
            <figure className="mt-36 sm:mt-40 lg:mt-32"><Screen name="home" alt="The OpenWarp home screen with sample data: headcount, approvals waiting, who is away and the directory" className="shadow-window" /><figcaption className="mt-3 text-[13px] text-muted">The OpenWarp workspace with sample data.</figcaption></figure>
          </div>
        </section>

        <section aria-labelledby="principles-title" className={container}>
          <h2 id="principles-title" className="sr-only">Why run OpenWarp</h2>
          <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {principles.map(({ icon: PrincipleIcon, title, description }) => <li key={title} className="border-t border-line pt-5">
              <PrincipleIcon aria-hidden="true" size={20} className="text-muted" />
              <h3 className="mt-3 text-[15px] font-semibold">{title}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-pretty text-muted">{description}</p>
            </li>)}
          </ul>
        </section>

        <section id="product" className={cn(container, "pt-24 sm:pt-32")}>
          <h2 className={cn(heading, "mb-8 max-w-[24ch] sm:mb-12")}>The work between someone’s first day and their last.</h2>
          <ModuleTabs label="Product areas" modules={modules.map(({ alt, ...module }) => ({ ...module, screen: <Screen name={module.id} alt={alt} /> }))} />
        </section>

        <section id="scope" className={cn(container, "pt-24 sm:pt-32")}>
          <h2 className={heading}>What’s in v0.3</h2>
          <p className={lead}>Everything below ships in one app with one database. Each area works on the same people records, so nothing has to be kept in sync.</p>
          <div className="mt-12 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {spec.map(({ icon: GroupIcon, title, items }) => <div key={title} className="border-t border-line pt-5">
              <h3 className="flex items-center gap-2 text-[15px] font-semibold"><GroupIcon aria-hidden="true" size={17} className="text-muted" />{title}</h3>
              <ul className="mt-3.5 grid gap-2">
                {items.map((item) => <li key={item} className="text-[15px] leading-snug text-pretty text-muted">{item}</li>)}
              </ul>
            </div>)}
          </div>
          <div className={cn(split, "mt-16 gap-y-5 border-t border-line pt-8")}>
            <div>
              <h3 className="text-[15px] font-semibold">Not included</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-pretty text-muted">OpenWarp keeps the record. Moving money and filing stay with your provider.</p>
            </div>
            <div>
              <ul className="flex flex-wrap gap-2">
                {excluded.map((item) => <li key={item} className="inline-flex min-h-8 items-center rounded-full border border-line-strong px-3 text-sm text-foreground">{item}</li>)}
              </ul>
              <p className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-pretty text-muted">If you need these today, keep the provider you have and use OpenWarp as the record behind it.</p>
            </div>
          </div>
        </section>

        <section id="self-host" className={cn(container, split, "pt-24 sm:pt-32")}>
          <div className="lg:sticky lg:top-24">
            <h2 className={heading}>Four steps to a running workspace</h2>
            <p className={lead}>You need a machine with Docker Engine and Compose v2. PostgreSQL comes up with the stack on an internal network, and the app runs as a non-root user.</p>
            <div className="mt-4 flex flex-col items-start">
              <a href={`${repositoryUrl}#self-host`} className={externalLink}>Full setup guide <ArrowUpRightIcon aria-hidden="true" size={15} /></a>
              <a href={`${repositoryUrl}/blob/main/docs/operations.md`} className={externalLink}>Backups and upgrades <ArrowUpRightIcon aria-hidden="true" size={15} /></a>
            </div>
          </div>
          <div className="min-w-0">
            <SetupSteps />
            <p className="mt-6 max-w-[62ch] text-[15px] leading-relaxed text-pretty text-muted sm:pl-16">
              <span className="font-medium text-foreground">Running it for a business?</span> Set <code className="font-mono text-[0.92em] text-foreground">BETTER_AUTH_URL</code> to your HTTPS address and put OpenWarp behind a TLS reverse proxy. The <a className={cn(textLink, "underline")} href={`${repositoryUrl}/blob/main/deploy/Caddyfile.example`}>Caddy example</a> is ready to adapt.
            </p>
          </div>
        </section>

        <section id="questions" className={cn(container, split, "py-24 sm:py-32")}>
          <div>
            <h2 className={heading}>Questions</h2>
            <p className={lead}>Something else? <a className={cn(textLink, "underline")} href={`${repositoryUrl}/issues`}>Ask on GitHub</a>.</p>
          </div>
          <div className="border-t border-line">
            {questions.map(({ question, answer }) => <details key={question} className="group border-b border-line">
              <summary className="flex min-h-16 items-center justify-between gap-6 rounded py-4 text-[17px] font-medium">
                {question}
                <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full border border-line-strong text-muted transition-[transform,border-color,color] duration-200 group-open:rotate-45 group-hover:border-control group-hover:text-foreground motion-reduce:transition-none"><PlusIcon size={13} weight="bold" /></span>
              </summary>
              <p className="max-w-[62ch] pr-12 pb-6 text-base leading-relaxed text-pretty text-muted">{answer}</p>
            </details>)}
          </div>
        </section>

        <section aria-labelledby="closing-title" className="relative isolate overflow-hidden border-t border-line">
          <HeroField className="closing-field h-full" level={0.12} showControl={false} />
          <div className={cn(container, "pt-24 pb-48 sm:pt-32 sm:pb-56")}>
            <h2 id="closing-title" className="max-w-[16ch] text-[clamp(2.1rem,4.8vw,3.4rem)] leading-[1.04] font-medium tracking-[-0.028em] text-balance">Keep your people records on your own terms.</h2>
            <p className="mt-5 max-w-[46ch] text-lg leading-[1.55] text-pretty text-muted">Run OpenWarp on a machine you control. There’s no account to open with us and no fee per person.</p>
            <div className="mt-8 flex flex-wrap items-center gap-2.5">
              <a href="#self-host" className={cn(primaryButton, largeButton)}>Start self-hosting <ArrowRightIcon aria-hidden="true" size={16} /></a>
              <a href={repositoryUrl} className={cn(secondaryButton, largeButton)}><GithubLogoIcon aria-hidden="true" size={17} />Star on GitHub</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className={cn(container, "grid gap-x-16 gap-y-12 pt-14 pb-12 md:grid-cols-[minmax(0,1fr)_auto]")}>
          <div className="max-w-[21rem]">
            <Brand />
            <p className="mt-2 text-sm leading-relaxed text-pretty text-muted">The open-source people system for companies that keep their records on their own server.</p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-14 gap-y-10 sm:grid-cols-3">
            {footerGroups.map(({ title, links }) => <div key={title}>
              <h2 className="text-[13px] font-medium text-hint">{title}</h2>
              <ul className="mt-3 grid gap-0.5">
                {links.map(({ label, href, internal }) => <li key={href}>
                  {internal ? <Link href={href} className={footerLink}>{label}</Link> : <a href={href} className={footerLink}>{label}</a>}
                </li>)}
              </ul>
            </div>)}
          </nav>
        </div>
        <div className={container}>
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 border-t border-line py-6 text-[13px] text-hint">
            <p>© {new Date().getFullYear()} OpenWarp contributors · AGPL-3.0</p>
            <p>Independent project, not affiliated with Warp.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
