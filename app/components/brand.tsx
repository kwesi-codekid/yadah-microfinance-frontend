import { cn } from "~/lib/utils";

/**
 * The company mark. It is a full-colour illustration on white — a ring of
 * people around a stack of cedi coins — so it always sits on a light tile,
 * never straight on a navy surface where its navy chain would disappear.
 */
export function BrandMark({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-white p-1 ring-1 ring-black/5",
        className,
      )}
      {...props}
    >
      <img src="/logo.png" alt="" className="size-full object-contain" draggable={false} />
    </span>
  );
}

/**
 * Mark plus wordmark. `tone="light"` is for dark surfaces — the navy sidebar
 * and the login photo — where the wordmark has to hold its own contrast.
 */
export function BrandLockup({
  tone = "dark",
  orientation = "horizontal",
  className,
}: {
  tone?: "dark" | "light";
  orientation?: "horizontal" | "stacked";
  className?: string;
}) {
  const stacked = orientation === "stacked";

  return (
    <span
      className={cn(
        "flex items-center",
        stacked ? "flex-col gap-4 text-center" : "gap-2.5",
        className,
      )}
    >
      <BrandMark className={stacked ? "size-20 rounded-2xl p-2.5" : undefined} />
      <span className={cn("flex flex-col", stacked ? "gap-1.5" : "gap-0.5")}>
        <span
          className={cn(
            "font-heading leading-none font-bold tracking-tight",
            stacked ? "text-2xl" : "text-sm",
            // Sky on dark surfaces — the accent that keeps its contrast on
            // navy. On white the wordmark stays ink.
            tone === "light" ? "text-brand-sky" : "text-foreground",
          )}
        >
          YADAH
        </span>
        <span
          className={cn(
            "font-heading leading-none font-semibold uppercase",
            stacked
              ? "text-[0.7rem] tracking-[0.25em]"
              : "text-[0.6rem] tracking-[0.18em]",
            tone === "light" ? "text-white/65" : "text-muted-foreground",
          )}
        >
          Dynamic Enterprise
        </span>
      </span>
    </span>
  );
}
