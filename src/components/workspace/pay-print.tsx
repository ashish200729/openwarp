"use client";

import { PrinterIcon } from "@/components/icons";
import { secondaryButton } from "@/components/ui";

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className={`${secondaryButton} print:hidden`}><PrinterIcon aria-hidden="true" size={15} /> Print or save as PDF</button>;
}
