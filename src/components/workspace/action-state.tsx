import { WarningCircleIcon } from "@/components/icons";

export type ActionState = { error?: string; fields?: Record<string, string[]>; message?: string; done?: number };

export function FormError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-2 text-sm font-medium text-danger">
      <WarningCircleIcon aria-hidden="true" size={17} weight="fill" className="mt-px shrink-0" />{error}
    </p>
  );
}
