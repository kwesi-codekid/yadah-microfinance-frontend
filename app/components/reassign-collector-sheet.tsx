import { Loader2Icon, TriangleAlertIcon, UserRoundCogIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher, useLocation } from "react-router";
import { toast } from "sonner";

import {
  RouteSheet,
  SheetActions,
  SheetBody,
  SheetCancel,
} from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";

/** A collector a customer can be moved to: an id and a name, nothing more. */
export interface CollectorOption {
  id: string;
  name: string;
}

/**
 * The reassign-collector panel, told everything it needs rather than fetching
 * it.
 *
 * Two routes render this. `customers-reassign` opens it over the listing and
 * hands it the row that was clicked and the collectors the page already read,
 * so opening costs nothing — no loader, no request, no wait. `customer-collector`
 * opens it over one customer's own page and reads the same two things from the
 * server first, because nothing on that page carries them.
 *
 * The panel does not care which. It takes the values as props and posts to the
 * one action either way, so there is a single place where a round actually
 * moves.
 */
export function ReassignCollectorSheet({
  customerId,
  fullName,
  assignedCollectorId,
  collectors,
}: {
  customerId: string;
  fullName: string;
  /** Empty when they are on nobody's round. */
  assignedCollectorId: string;
  collectors: CollectorOption[];
}) {
  // A fetcher rather than a navigating `Form`: the submission posts to the
  // action below `customers/:id`, which is not the route this panel is on when
  // it opens over the listing. The action redirects on success, and the router
  // follows a fetcher's redirect the same as a form's.
  const fetcher = useFetcher<{ error?: string }>();
  const { pathname, search } = useLocation();
  const submitting = fetcher.state !== "idle";
  const error = fetcher.data?.error;

  const [collectorId, setCollectorId] = useState(assignedCollectorId);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const current = collectors.find((c) => c.id === assignedCollectorId);
  const unchanged = collectorId === assignedCollectorId;

  // Which page is behind the panel, read off the browser's own URL. Closing
  // and saving both have to land on the one they were reading — the listing
  // when it opened over the rows, the customer when it opened over their page.
  //
  // Without the query string: `RouteSheet` appends whatever filters are on the
  // page underneath, and appending them twice would be a broken URL. The
  // action gets them separately, as a field of their own.
  const backTo = pathname.endsWith("/reassign")
    ? "/customers"
    : `/customers/${customerId}`;

  return (
    <RouteSheet backTo={backTo} title="Reassign collector" description={fullName}>
      <fetcher.Form
        method="post"
        action={`/customers/${customerId}/collector`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* Saving lands where cancelling does. The action cannot work this out
            for itself — see the note there. */}
        <input type="hidden" name="backTo" value={backTo} />
        <input type="hidden" name="search" value={search} />

        <SheetBody className="space-y-6">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <p className="font-medium">{error}</p>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              On the round of
            </p>
            <p className="mt-0.5 font-semibold">
              {current?.name ??
                (assignedCollectorId ? "A collector no longer active" : "Nobody")}
            </p>
          </div>

          {collectors.length === 0 ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              There are no active collectors to move them to. Add one under Staff
              first.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Move to<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Select
                name="collectorId"
                value={collectorId}
                onValueChange={setCollectorId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick a collector" />
                </SelectTrigger>
                <SelectContent>
                  {collectors.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {unchanged && assignedCollectorId && (
                <p className="text-xs text-muted-foreground">
                  That is already their round.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label
              htmlFor="reason"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Reason
            </Label>
            <Textarea
              id="reason"
              name="reason"
              rows={3}
              maxLength={300}
              placeholder="Moved zones, covering leave, customer asked."
            />
            <p className="text-xs text-muted-foreground">
              Recorded with the change, so the books can still answer who owned
              this customer on any given day.
            </p>
          </div>
        </SheetBody>

        <SheetActions>
          <SheetCancel />
          <Button
            type="submit"
            disabled={submitting || !collectorId || unchanged || collectors.length === 0}
          >
            {submitting ? <Loader2Icon className="animate-spin" /> : <UserRoundCogIcon />}
            Reassign
          </Button>
        </SheetActions>
      </fetcher.Form>
    </RouteSheet>
  );
}
