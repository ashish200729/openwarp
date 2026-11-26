"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/icons";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [result, setResult] = useState<"copied" | "failed">();

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(undefined), 2000);
    return () => clearTimeout(timer);
  }, [result]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setResult("copied");
    } catch {
      setResult("failed");
    }
  }

  const Icon = result === "copied" ? CheckIcon : CopyIcon;
  return <>
    <button type="button" onClick={copy} aria-label={label} className="inline-flex min-h-9 items-center gap-2 rounded-[7px] px-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-raised hover:text-foreground motion-reduce:transition-none">
      <Icon aria-hidden="true" size={14} className={result === "copied" ? "text-positive" : undefined} />
      <span aria-hidden="true">{result === "copied" ? "Copied" : result === "failed" ? "Select and copy" : "Copy"}</span>
    </button>
    <span role="status" className="sr-only">{result === "copied" ? "Copied to clipboard" : result === "failed" ? "Copying is blocked. Select the commands and copy them." : ""}</span>
  </>;
}
