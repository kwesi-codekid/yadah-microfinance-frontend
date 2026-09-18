import { Navigate } from "react-router";

import { ReassignCollectorSheet } from "~/components/reassign-collector-sheet";
import type { Route } from "./+types/customers-reassign";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Reassign collector · Yadah Dynamic Enterprise" }];
}

/**
 * The reassign drawer, over the listing.
 *
 * Deliberately loaderless, and that is the whole point of it. A route with a
 * loader is a route the router has to go to the server for before it can
 * render, so every opening of this panel cost a round trip and two API calls —
 * one to read a customer already on screen, one to read a collector list that
 * is the same on every opening. What people saw was a click that did nothing,
 * then the progress bar, then the drawer.
 *
 * Nothing here needs asking. The row was clicked from a table that already
 * holds the name and the round, and `/customers` reads the collectors once with
 * the page, so both are a lookup away in the parent's data. With no loader the
 * router has nothing to fetch and the panel opens in the same frame as the
 * click.
 *
 * The gate does not move: the action this posts to still calls
 * `requireCounter`, which is where it belongs — a menu item can be disabled,
 * but only the server can refuse.
 *
 * `/customers/:id/collector` is the same errand over the customer's own page,
 * and it does have a loader. Cold links land here without the parent's rows to
 * read, so this hands them there.
 */
export default function CustomersReassign({
  params,
  matches,
}: Route.ComponentProps) {
  // The listing this drawer is drawn over, and the data it already read.
  const listing = matches.find(
    (m): m is Extract<typeof m, { id: "routes/customers" }> =>
      m?.id === "routes/customers",
  );
  const row = listing?.loaderData.rows.find((r) => r.id === params.id);
  const collectors = listing?.loaderData.collectors;

  // Pasted cold, paged past, or the staff list was briefly unavailable when
  // the page loaded. The route that fetches for itself is slower but never
  // depends on what happens to be on screen.
  if (!row || !collectors) {
    return <Navigate to={`/customers/${params.id}/collector`} replace />;
  }

  return (
    <ReassignCollectorSheet
      customerId={row.id}
      fullName={row.fullName}
      assignedCollectorId={row.assignedCollectorId}
      collectors={collectors}
    />
  );
}
