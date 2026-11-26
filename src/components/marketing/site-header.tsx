import { Brand, repositoryUrl } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { PixelEdgeButton } from "./pixel-edge-button";
import { HeaderFrame } from "./header-frame";
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
    <HeaderFrame>
      <div className="mx-auto flex h-full max-w-[74rem] items-center justify-between gap-2 px-4 sm:px-8">
        <Brand />
        <nav aria-label="Main navigation" className="hidden items-center gap-0.5 md:flex">
          {siteLinks.map(({ label, href }) => <a key={href} href={href} className="inline-flex min-h-9 items-center rounded-[7px] px-3 text-sm text-muted transition-colors hover:bg-raised hover:text-foreground motion-reduce:transition-none">{label}</a>)}
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <PixelEdgeButton href="/get-started" className="hidden sm:inline-flex">Open workspace</PixelEdgeButton>
          <MobileMenu links={siteLinks} />
        </div>
      </div>
    </HeaderFrame>
  );
}
