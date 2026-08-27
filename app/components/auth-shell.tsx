import type { ReactNode } from "react";

import { BrandLockup } from "~/components/brand";
import { ThemeToggle } from "~/components/theme-toggle";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { cn } from "~/lib/utils";

/**
 * The frame every signed-out page shares: the photo on one side, the form on
 * the other. On a phone the photo becomes the backdrop and the form docks to
 * the bottom edge, where a thumb already is.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  /** Secondary links under the form — switching method, going back. */
  footer?: ReactNode;
}) {
  return (
    <main className="relative min-h-dvh w-full overflow-hidden lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* Phone and tablet: the photo is the page. */}
      <Photo className="absolute inset-0 lg:hidden" />

      {/* Desktop: the photo is the left column, and carries the brand. */}
      <Photo className="relative hidden lg:block">
        <div className="relative flex h-full flex-col items-center justify-between p-12 text-left">
          <BrandLockup tone="light" />

          <div className="max-w-sm">
            <p className="font-heading text-3xl leading-tight font-bold text-white">
              Every cedi collected,
              <br />
              accounted for the same day.
            </p>
          </div>

          <p className="text-xs text-white/50">
            Yadah Dynamic Enterprise · Ghana
          </p>
        </div>
      </Photo>

      <ThemeToggle className="absolute top-4 right-4 z-20 text-white hover:bg-white/10 hover:text-white lg:text-foreground lg:hover:bg-muted lg:hover:text-foreground" />

      <div className="relative z-10 flex min-h-dvh flex-col justify-end lg:min-h-0 lg:items-center lg:justify-center lg:bg-background">
        {/* The brand has no column of its own on small screens, so it sits here. */}
        <div className="flex flex-1 items-center justify-center p-8 lg:hidden">
          <BrandLockup tone="light" orientation="stacked" />
        </div>

        <section
          className={cn(
            "w-full bg-background px-6 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))]",
            "rounded-t-[2rem] ring-1 ring-black/5 dark:ring-white/10",
            "animate-in slide-in-from-bottom-8 duration-500 ease-out motion-reduce:animate-none",
            "lg:max-w-sm lg:rounded-none lg:px-8 lg:py-0 lg:ring-0 lg:animate-none",
          )}
        >
          <div className="mx-auto w-full max-w-sm">
            <header className="mb-7 space-y-1.5 text-center">
              <h1 className="font-heading text-3xl font-bold tracking-tight">
                {title}
              </h1>
              <p className="text-sm text-muted-foreground">{description}</p>
            </header>

            {children}

            {footer ? <div className="mt-6 space-y-2.5">{footer}</div> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

/** The photograph plus the navy wash that keeps white type legible over it. */
function Photo({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("overflow-hidden bg-brand-navy", className)}>
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/login.jpg')" }}
      />
      {/* A dark scrim over the photograph, keeping white type legible. */}
      <div aria-hidden="true" className="absolute inset-0 bg-black/35" />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-black/25"
      />
      {children}
    </div>
  );
}

/** A form-level failure: the API said no, and it is not one field's fault. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <Alert
      variant="destructive"
      className="mb-5 border-destructive/30 bg-destructive/10"
    >
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/** A form-level confirmation carried across a redirect. */
export function FormNotice({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "warning";
  children: ReactNode;
}) {
  return (
    <Alert
      role="status"
      className={cn(
        "mb-5",
        tone === "success" && "border-success/30 bg-success-subtle",
        tone === "warning" && "border-warning/30 bg-warning-subtle",
        tone === "info" && "border-info/30 bg-info-subtle",
      )}
    >
      <AlertDescription
        className={cn(
          tone === "success" && "text-success dark:text-success",
          tone === "warning" && "text-warning dark:text-warning",
          tone === "info" && "text-info dark:text-info",
        )}
      >
        {children}
      </AlertDescription>
    </Alert>
  );
}
