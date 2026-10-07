import { cn } from "~/lib/utils";

/**
 * Marks a customer under 18. Worth saying wherever the name is: a child may be
 * on a parent's phone number, and cannot take a loan or hire purchase.
 */
export function ChildTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-info/15 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-info uppercase",
        className,
      )}
      title="Under 18 — can share a parent's phone number, no loans or hire purchase"
    >
      Child
    </span>
  );
}
