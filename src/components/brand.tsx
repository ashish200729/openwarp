import Link from "next/link";

export const repositoryUrl = "https://github.com/ashish200729/openwarp";

// Three threads crossing one weft: the warp of a loom.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" className={className}>
      <path d="M5 2v7.2M5 14.8V22M12 2v20M19 2v7.2M19 14.8V22M2 12h7.2M14.8 12H22" />
    </svg>
  );
}

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} aria-label="OpenWarp home" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md text-[17px] font-semibold tracking-[-0.02em]">
      <BrandMark className="size-5 shrink-0" />
      OpenWarp
    </Link>
  );
}
