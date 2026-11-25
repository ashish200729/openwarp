import Link from "next/link";

export const repositoryUrl = "https://github.com/ashish200729/openwarp";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} aria-label="OpenWarp home" className="inline-flex min-h-10 items-center gap-2.5 rounded-sm font-semibold tracking-[-0.055em] text-[21px]">
      <span aria-hidden="true" className="relative grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent/12 text-accent">
        <span className="absolute left-[6px] top-[6px] size-[3px] bg-current shadow-[6px_6px_currentColor,0px_6px_currentColor,12px_0_currentColor,12px_6px_currentColor,3px_12px_currentColor,9px_12px_currentColor]" />
      </span>
      openwarp<span aria-hidden="true" className="-ml-2 text-accent">.</span>
    </Link>
  );
}
