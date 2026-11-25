import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, GitFork, History, ListChecks, Network, Terminal } from "lucide-react";
import { Brand, repositoryUrl } from "@/components/brand";
import { ButtonPixels, primaryButton, secondaryButton } from "@/components/ui";
import { DirectoryPreview } from "@/components/marketing/directory-preview";
import { WorkforceChart } from "@/components/marketing/workforce-chart";

const capabilities = [
  { title: "Employee directory", description: "Find anyone by name, role, or team. See who reports to whom and keep work details current.", icon: Network, color: "text-orchid" },
  { title: "Onboarding and offboarding", description: "Track what’s complete and what still needs doing when someone joins or leaves.", icon: ListChecks, color: "text-rose" },
  { title: "Activity history", description: "See who changed a record and when, with a history your admins can review.", icon: History, color: "text-peach" },
];

export default function HomePage() {
  return (
    <>
      <header className="border-b border-line/80">
        <div className="mx-auto flex min-h-16 max-w-[80rem] flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-2 sm:gap-x-4 sm:px-8 lg:px-10">
          <Brand />
          <nav aria-label="Main navigation" className="flex items-center gap-3 sm:gap-6">
            <a href="#product" className="hidden min-h-11 items-center rounded-sm text-sm text-muted hover:text-foreground sm:inline-flex">Product</a>
            <a href="#self-host" className="hidden min-h-11 items-center rounded-sm text-sm text-muted hover:text-foreground sm:inline-flex">Self-hosting</a>
            <a href={repositoryUrl} className="hidden min-h-11 items-center gap-2 rounded-sm text-sm text-muted hover:text-foreground sm:inline-flex"><GitFork aria-hidden="true" size={15} /> GitHub</a>
            <Link href="/login" className={secondaryButton}>Open workspace <ArrowUpRight aria-hidden="true" size={15} className="hidden sm:block" /></Link>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[80rem] px-5 sm:px-8 lg:px-10">
        <section className="grid items-center gap-9 pb-12 pt-12 sm:gap-12 sm:py-16 lg:grid-cols-[minmax(0,1.14fr)_minmax(0,1fr)] lg:gap-10 lg:pb-[4.75rem] lg:pt-[5.25rem] xl:gap-14">
          <div className="min-w-0">
            <p className="flex items-center gap-2.5 font-mono text-[11px] font-medium tracking-[0.18em] text-accent uppercase"><span aria-hidden="true" className="pixel-fill size-2.5 [--pixel-size:6px] [--pixel:currentColor]" /> Open-source HR software</p>
            <h1 className="mt-5 max-w-[13ch] text-[clamp(2.7rem,7.3vw,4.9rem)] font-medium leading-[0.99] tracking-[-0.079em] lg:text-[clamp(3.6rem,5.6vw,4.9rem)]">
              The people system <span className="text-accent">you own.</span>
            </h1>
            <p className="mt-6 max-w-[42ch] text-base leading-relaxed text-muted sm:text-lg">
              Manage employees, teams, and every step from first day to last. Run it on your own infrastructure and keep your people data in your hands.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-2.5 sm:mt-8">
              <a href="#self-host" className={primaryButton}><ButtonPixels /> Self-host OpenWarp <ArrowRight aria-hidden="true" size={16} /></a>
              <a href="#product" className={secondaryButton}>Explore the product <ArrowDown aria-hidden="true" size={15} /></a>
            </div>
          </div>
          <WorkforceChart />
        </section>

        <section id="product" aria-label="Product preview" className="scroll-mt-6">
          <DirectoryPreview />
          <div className="mt-5 grid divide-y divide-line rounded-xl border border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {capabilities.map(({ title, description, icon: Icon, color }) => (
              <article key={title} className="p-5 sm:p-6 lg:p-7">
                <span className={`relative grid size-10 place-items-center rounded-md border border-line bg-panel ${color}`}><Icon aria-hidden="true" size={19} /><span aria-hidden="true" className="absolute -right-px -top-px size-2 bg-current" /></span>
                <h3 className="mt-4 text-base font-medium tracking-tight">{title}</h3>
                <p className="mt-1.5 max-w-[35ch] text-sm leading-relaxed text-muted">{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="self-host" className="grid items-center gap-6 py-14 sm:py-20 md:grid-cols-2 md:gap-12">
          <div>
            <h2 className="text-[clamp(1.85rem,5vw,3rem)] font-medium leading-tight tracking-[-0.065em]">Run it on your terms.</h2>
            <p className="mt-3 max-w-[42ch] leading-relaxed text-muted">Deploy with Docker Compose and PostgreSQL. The source is open and there’s no per-employee software fee.</p>
            <a href={`${repositoryUrl}#self-host`} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-medium text-accent hover:underline">Read the setup guide <ArrowUpRight aria-hidden="true" size={16} /></a>
          </div>
          <div className="overflow-hidden rounded-xl border border-line bg-panel">
            <div className="flex items-center gap-2.5 border-b border-line px-4 py-3 font-mono text-xs text-muted"><Terminal size={16} aria-hidden="true" /> Terminal</div>
            <div className="space-y-2 p-4 font-mono text-xs leading-relaxed break-all sm:text-sm">
              <p><span aria-hidden="true" className="select-none text-accent">$ </span>git clone {repositoryUrl}.git</p>
              <p><span aria-hidden="true" className="select-none text-accent">$ </span>cd openwarp</p>
              <p className="text-muted"># Configure .env, then start the stack</p>
              <p><span aria-hidden="true" className="select-none text-accent">$ </span>docker compose up -d --build</p>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-line/80">
        <div className="mx-auto flex max-w-[80rem] flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-8 lg:px-10">
          <Brand />
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
            <a href={`${repositoryUrl}/blob/main/LICENSE`} className="inline-flex min-h-10 items-center hover:text-foreground">AGPL-3.0</a>
            <a href={repositoryUrl} className="inline-flex min-h-10 items-center gap-1.5 hover:text-foreground">Source code <ArrowUpRight aria-hidden="true" size={14} /></a>
          </div>
        </div>
      </footer>
    </>
  );
}
