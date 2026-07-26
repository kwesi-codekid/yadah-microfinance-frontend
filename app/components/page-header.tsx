import { Link } from "react-router";
import { ChevronLeft } from "lucide-react";

/**
 * Heading for a full-page view that sits below a list — register, edit, detail.
 *
 * The back link is a real `<Link>` to the parent, not `history.back()`: these
 * pages are reachable by URL (a shared link, a bookmark, a redirect after
 * creating a record), and in those cases there is nothing behind them.
 */
export function PageHeader({
  backTo,
  backLabel,
  title,
  subtitle,
  actions,
}: {
  backTo: string;
  backLabel: string;
  title: string;
  subtitle?: string;
  /** Buttons for this page, right-aligned beside the title. */
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
     

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            {title}
          </h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
