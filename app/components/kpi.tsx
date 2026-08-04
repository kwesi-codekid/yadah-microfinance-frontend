export const PANEL = "rounded-lg border-2 border-border bg-surface dark:bg-canvas";

export const PANEL_TITLE = "text-xs font-bold uppercase tracking-wide text-muted";

export function Kpi({
  icon,
  label,
  value,
  foot,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  foot?: React.ReactNode;
  tone?: "danger" | "success";
}) {
  const VALUE_TONE = {
    danger: "text-red-600 dark:text-red-400",
    success: "text-success",
  } as const;

  return (
    <div className={`${PANEL} relative overflow-hidden px-4 py-2.5`}>
      {/* The same glyph, blown up and barely there — texture, not information. */}
      {icon && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-3 -right-3 text-foreground opacity-[0.035] mask-[linear-gradient(to_top_left,black,transparent)] dark:opacity-[0.06] [&>svg]:size-20 [&>svg]:stroke-[1.25]"
        >
          {icon}
        </span>
      )}
      <div className="relative">
        <p className="flex items-center gap-1.5 truncate text-xs font-medium uppercase tracking-wide text-muted">
          {icon && (
            <span aria-hidden="true" className="shrink-0">
              {icon}
            </span>
          )}
          {label}
        </p>
        <p
          className={`mt-0.5 truncate font-sen text-lg font-semibold tabular-nums 2xl:text-xl ${
            tone ? VALUE_TONE[tone] : "text-foreground"
          }`}
        >
          {value}
        </p>
        {foot}
      </div>
    </div>
  );
}
