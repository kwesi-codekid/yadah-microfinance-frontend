import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * The row of summary cards a book opens with — the loans and savings pages'
 * own: the amount, then what it is, and nothing else. Two across on a phone,
 * one row on a desktop.
 */
export function StatBand({
  columns = 4,
  children,
}: {
  /** How many cards share the row on a wide screen. */
  columns?: 3 | 4 | 5;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-4",
        columns === 3 && "lg:grid-cols-3",
        columns === 4 && "lg:grid-cols-4",
        columns === 5 && "lg:grid-cols-5",
      )}
    >
      {children}
    </div>
  );
}

export type StatTone = "in" | "out" | "danger" | "revenue" | "neutral";

export function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: StatTone;
}) {
  return (
    <div className="relative rounded-2xl bg-card p-4">
      {/* Keyed so a change of filter re-enters the number instead of snapping. */}
      <p
        key={value}
        className={cn(
          "tabular animate-in fade-in slide-in-from-bottom-1 text-lg font-bold tracking-tight duration-300 motion-reduce:animate-none",
          tone === "in" && "text-cash-in",
          tone === "out" && "text-cash-out",
          tone === "danger" && "text-danger",
          tone === "revenue" && "text-revenue-foreground",
          tone === "neutral" && "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs font-medium">{label}</p>
    </div>
  );
}
