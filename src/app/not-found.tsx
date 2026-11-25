import Link from "next/link";
import { Brand } from "@/components/brand";
import { secondaryButton } from "@/components/ui";

export default function NotFound() {
  return <main id="main" tabIndex={-1} className="mx-auto grid min-h-dvh max-w-lg content-center gap-4 px-5 py-12">
    <Brand />
    <h1 className="text-3xl font-medium tracking-tight">Page unavailable</h1>
    <p className="text-sm text-muted">Check the address, or return to the OpenWarp home page.</p>
    <Link className={`${secondaryButton} justify-self-start`} href="/">Open home page</Link>
  </main>;
}
