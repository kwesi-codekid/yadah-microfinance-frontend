/**
 * The panel and the KPI tile, for the whole app.
 *
 * Both started out local to [dashboard.tsx](app/routes/dashboard.tsx); they
 * moved here when the loan pages needed the same tile, the same way
 * [form-fields.tsx](app/components/form-fields.tsx) came out of `staff.tsx` once
 * `customers.tsx` wanted the same inputs. A second copy would have been a second
 * definition of what a figure looks like in this app, and those drift.
 */

/**
 * Every card surface: KPI tiles, charted panels, rail panels.
 *
 * `dark:bg-canvas` rather than the surface colour the rest of the app's cards
 * wear. In the light theme the split does work — white panels on a grey canvas
 * is what makes a layout read as panels. In the dark one the canvas is already
 * near-black, and lifting each card to `--surface` turns a page of fifteen of
 * them into fifteen grey rectangles; the `border-2` is enough to hold their
 * edges without the fill.
 */
export const PANEL = "rounded-lg border-2 border-border bg-surface dark:bg-canvas";

export const PANEL_TITLE = "text-xs font-bold uppercase tracking-wide text-muted";

/**
 * One figure, in a tile: an iconed label, the number, and an optional foot.
 *
 * The foot is where the number's context goes — a comparison, a split, a
 * progress bar. Keep it to one line: a band of these is read *across*, and a
 * second line on one tile sets the height of all of them.
 *
 * `tone` marks a figure that is bad news rather than merely large. It colours
 * the value only; the label and foot stay muted, so a row of tiles doesn't turn
 * into a traffic light.
 */
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
    /* `px-4` and a value that only reaches `text-xl` on the widest screens: six
       of these across a page is a ~200px column, and a figure like
       ₵1,234,567.00 at 24px does not fit one. The vertical rhythm is tight on
       purpose — every row of padding here is repeated once per tile. */
    <div className={`${PANEL} px-4 py-2.5`}>
      <p className="flex items-center gap-1.5 truncate text-[11px] font-medium uppercase tracking-wide text-muted">
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
  );
}
