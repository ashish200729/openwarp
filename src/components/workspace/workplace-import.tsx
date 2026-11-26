"use client";

import { useActionState, useState } from "react";
import { importDevicesAction, type DeviceImportState } from "@/app/(workspace)/workspace/devices/actions";
import { tableBody, tableHead } from "@/components/ui";
import { CsvInput } from "./csv-input";
import { FormError } from "./action-state";
import { SubmitButton } from "./buttons";

export function DeviceImportForm() {
  const [state, run, pending] = useActionState<DeviceImportState, FormData>(importDevicesAction, {});
  const [file, setFile] = useState<string>();
  const [checked, setChecked] = useState<string>();
  const plan = checked === file ? state.plan : undefined;
  const ready = plan && plan.problems.length === 0;
  const noun = plan?.count === 1 ? "device" : "devices";

  return <form action={(data) => { setChecked(file); run(data); }} aria-busy={pending} className="grid max-w-2xl gap-5">
    <input type="hidden" name="csv" value={file ?? ""} />
    <CsvInput onFile={setFile} />
    <FormError error={state.error} />
    {plan && <div role="status" className="text-sm">{ready ? <p className="font-semibold">{plan.count} {noun} ready to import.</p> : <>
      <p className="mb-3 font-semibold text-danger">Fix these rows, then choose the file again. Nothing was imported.</p>
      <table className="w-full"><caption className="sr-only">Problems in the file</caption><thead className={tableHead}><tr><th scope="col" className="w-20">Row</th><th scope="col">Problem</th></tr></thead><tbody className={tableBody}>{plan.problems.map((problem, index) => <tr key={index}><td className="align-top tabular-nums">{problem.row}</td><td className="wrap-anywhere">{problem.message}</td></tr>)}</tbody></table>
    </>}</div>}
    <div className="flex flex-wrap gap-2">
      <SubmitButton name="operation" value="check" disabled={!file} variant={ready ? "secondary" : "primary"} pending="Checking…">Check file</SubmitButton>
      {ready && <SubmitButton name="operation" value="import" pending="Importing…">Import {plan.count} {noun}</SubmitButton>}
    </div>
  </form>;
}
