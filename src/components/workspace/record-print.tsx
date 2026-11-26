"use client";

import { PrinterIcon } from "@/components/icons";
import { secondaryButton } from "@/components/ui";

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className={secondaryButton}><PrinterIcon aria-hidden="true" size={15} /> Print</button>;
}
