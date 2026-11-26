import Link from "next/link";
import { Brand, repositoryUrl } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { primaryButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { MobileMenu } from "./mobile-menu";

export const siteLinks = [
  { label: "Product", href: "#product" },
  { label: "Scope", href: "#scope" },
  { label: "Self-hosting", href: "#self-host" },
  { label: "Questions", href: "#questions" },
  { label: "GitHub", href: repositoryUrl },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="mx-auto flex min-h-14 max-w-[74rem] items-center justify-between gap-2 px-4 sm:px-8">
        <Brand />
        <nav aria-label="Main navigation" className="hidden items-center gap-0.5 md:flex">
          {siteLinks.map(({ label, href }) => <a key={href} href={href} className="inline-flex min-h-9 items-center rounded-[7px] px-3 text-sm text-muted hover:bg-raised hover:text-foreground">{label}</a>)}
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <Link href="/login" className={cn(primaryButton, "hidden sm:inline-flex")}>Open workspace</Link>
          <MobileMenu links={siteLinks} />
        </div>
      </div>
    </header>
  );
}
