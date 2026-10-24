/**
 * A dashboard tile figure with the currency mark set small, so a full amount
 * like `1,234,567.89` keeps its digits on one line. Anything that is not a
 * `formatPesewas` string (a count, a dash) is drawn as given.
 */
export function TileFigure({ value }: { value: string }) {
  if (!value.startsWith("GH₵ ")) return <>{value}</>;
  return (
    <>
      <span className="mr-1 text-[0.6em] font-semibold text-muted-foreground">
        GH₵
      </span>
      {value.slice(4)}
    </>
  );
}
