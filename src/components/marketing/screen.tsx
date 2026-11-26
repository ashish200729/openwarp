import Image from "next/image";
import { cn } from "@/lib/utils";

// The captures are already sized WebP files. Lazy loading keeps the hidden theme and size from downloading.
export function Screen({ name, alt, className }: { name: string; alt: string; className?: string }) {
  return <div className={cn("overflow-hidden rounded-[10px] border border-line-strong bg-background", className)}>
    {(["light", "dark"] as const).map((theme) => <div key={theme} className={theme === "light" ? "dark:hidden" : "hidden dark:block"}>
      <Image unoptimized src={`/screens/${name}-wide-${theme}.webp`} width={2560} height={1600} alt={alt} className="hidden h-auto w-full sm:block" />
      <Image unoptimized src={`/screens/${name}-narrow-${theme}.webp`} width={780} height={1400} alt={alt} className="h-auto w-full sm:hidden" />
    </div>)}
  </div>;
}
