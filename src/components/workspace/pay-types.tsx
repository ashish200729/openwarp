import { Checkbox } from "@/components/workspace/action-form";
import { employmentLabels, employmentTypes, type EmploymentType } from "@/lib/people";

export function EmploymentTypes({ selected }: { selected: EmploymentType[] }) {
  return <fieldset className="min-w-0"><legend className="mb-2 text-sm font-medium">Employment types<span className="ml-1.5 text-[13px] font-normal text-muted">None selected means all</span></legend>
    <div className="flex flex-wrap gap-x-6 gap-y-2.5">{employmentTypes.map((type) => <Checkbox key={type} name={`type-${type}`} label={employmentLabels[type]} defaultChecked={selected.includes(type)} />)}</div></fieldset>;
}

export function typeSummary(types: EmploymentType[]) {
  return types.length ? types.map((type) => employmentLabels[type]).join(", ") : "Everyone";
}
