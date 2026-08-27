import { ArrowLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link, type To } from "react-router";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "~/components/ui/empty";
import { cn } from "~/lib/utils";

/**
 * The padded column every in-app page lays its content out in. `contentClassName`
 * narrows the content — a form reads better at `max-w-lg` — without pulling it
 * into the middle of the page, away from the rail it was reached from.
 */
export function Page({
  className,
  contentClassName,
  children,
}: {
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-4 py-6 sm:px-6", className)}>
      <div className={cn("w-full", contentClassName)}>{children}</div>
    </div>
  );
}

/**
 * The way out of a detail page — the same arrow, the same size, the same
 * muted-to-foreground hover everywhere, so "up one level" always looks like
 * itself. Name where you land ("All customers") when the page does not already
 * say so; the default "Back" is there for when the header opposite already
 * spells the destination out and repeating it would only be noise.
 *
 * It carries no margin of its own: standing alone above a header it wants
 * `className="mb-4"`, while inside a header row the header's own gap and
 * bottom margin already space it.
 */
export function BackLink({
  to,
  children = "Back",
  className,
}: {
  to: To;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      <ArrowLeftIcon className="size-4" />
      {children}
    </Link>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h2 className="font-heading text-2xl font-bold tracking-tight">{title}</h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * Stands in for a module that is routed and reachable but not built yet. It
 * says what will be here rather than pretending the screen is empty of data.
 */
export function ModulePlaceholder({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Empty className="min-h-[60vh]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon className="size-6" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
