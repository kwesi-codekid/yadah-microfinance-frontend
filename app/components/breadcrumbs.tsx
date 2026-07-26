import { Fragment } from "react";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";

/**
 * The trail back up, for a page nested under a record.
 *
 * Real `<Link>`s to each ancestor rather than `history.back()`: these pages are
 * reachable by URL — a shared link, a bookmark, a redirect after saving — and
 * in those cases there is nothing behind them to go back to.
 *
 * The last crumb is the page you are on, so it is text, not a link, and carries
 * `aria-current="page"`. Anything before it must have a `to`.
 */
export type Crumb = { label: string; to?: string };

export function Breadcrumbs({
  items,
  className = "",
}: {
  items: Crumb[];
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={`${item.label}-${i}`}>
              <li className="min-w-0">
                {item.to && !last ? (
                  <Link
                    to={item.to}
                    className="block max-w-64 truncate rounded-sm text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    aria-current={last ? "page" : undefined}
                    className="block max-w-64 truncate font-medium text-foreground"
                  >
                    {item.label}
                  </span>
                )}
              </li>
              {!last && (
                <li aria-hidden="true" className="text-muted/60">
                  <ChevronRight size={14} />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
