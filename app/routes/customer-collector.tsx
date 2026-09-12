import { data } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { listCollectors } from "~/api/collectors";
import { getCustomer, reassignCustomerCollector } from "~/api/customers";
import { ApiError } from "~/api/error";
import { ReassignCollectorSheet } from "~/components/reassign-collector-sheet";
import { NO_COLLECTOR } from "~/lib/customer-form";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/customer-collector";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Reassign collector · Yadah Dynamic Enterprise" }];
}

/**
 * `PATCH /customers/:id/collector` — move one customer to another round.
 *
 * Counter work: whoever registers a customer puts them on a round, and the
 * same people may move them — admin, manager or teller. Handing over a whole
 * round stays admin-only, on the staff page. It is also the *only* way the
 * field changes — a profile update ignores it — which is why this is a route
 * of its own rather than a field on the edit form.
 *
 * The roster comes from `GET /collectors`, the one the counter may read; the
 * staff directory behind `GET /users` is the office's.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const [{ customer }, roster] = await Promise.all([
        getCustomer(token, params.id),
        listCollectors(token),
      ]);
      return { customer, collectors: roster.collectors };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data(
    {
      customer: {
        id: result.customer.id,
        fullName: result.customer.fullName,
        assignedCollectorId: result.customer.assignedCollectorId ?? "",
      },
      collectors: result.collectors.map(({ id, name }) => ({ id, name })),
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  // The select posts a sentinel for "nobody": the API takes null to mean the
  // customer is on no round and pays at the counter.
  const picked = String(form.get("collectorId") ?? "").trim();
  const collectorId = picked === NO_COLLECTOR ? null : picked;
  const reason = String(form.get("reason") ?? "").trim();

  // Where the drawer opened from, and the filters that were on the page
  // underneath it — both carried in by the form.
  //
  // This action serves both drawers: the one over the listing posts here from
  // `/customers/:id/reassign`, the one over the customer's page from this very
  // path. So the form field is the only thing that says which page is waiting
  // behind the panel. It cannot be read off `request.url`, which is this route
  // either way, nor off the `Referer`, which Single Fetch rewrites.
  //
  // Matched against a known value rather than trusted: it decides a redirect,
  // and a redirect taking its target from a form field is how open redirects
  // are written. The query string only ever rides on a fixed path, and only as
  // a query string.
  const search = String(form.get("search") ?? "");
  const backTo =
    form.get("backTo") === "/customers"
      ? `/customers${search.startsWith("?") ? search : ""}`
      : `/customers/${params.id}`;

  if (collectorId === "") {
    return data({ error: "Pick who takes them on." }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      reassignCustomerCollector(token, params.id, {
        collectorId,
        ...(reason ? { reason } : {}),
      }),
    );

    await redirectWithToast(
      backTo,
      {
        tone: "success",
        message: collectorId
          ? `${result.customer.fullName} moved to another round.`
          : `${result.customer.fullName} now pays at the office.`,
        description: collectorId
          ? "The change is recorded against the customer."
          : "They are on nobody's round. The change is recorded against them.",
      },
      headers,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status },
      );
    }
    throw error;
  }
}

/**
 * Over the customer's own page, which carries neither the round they are on
 * nor the collectors they could move to — so unlike the drawer over the
 * listing, this one has to ask before it can draw.
 */
export default function CustomerCollector({ loaderData }: Route.ComponentProps) {
  const { customer, collectors } = loaderData;

  return (
    <ReassignCollectorSheet
      customerId={customer.id}
      fullName={customer.fullName}
      assignedCollectorId={customer.assignedCollectorId}
      collectors={collectors}
    />
  );
}
