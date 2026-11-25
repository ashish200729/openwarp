import { CircleAlert } from "lucide-react";

export type ActionState = { error?: string; fields?: Record<string, string[]> };

export function FormError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/8 p-3 text-sm text-danger">
      <CircleAlert aria-hidden="true" size={16} className="mt-0.5 shrink-0" />{error}
    </p>
  );
}
