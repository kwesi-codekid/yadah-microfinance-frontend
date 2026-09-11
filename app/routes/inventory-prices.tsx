import { ArrowDownRightIcon, ArrowUpRightIcon, HistoryIcon } from "lucide-react";
import { data, Link } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { listItems, listPriceChanges } from "~/api/hire-purchase";
import { RouteSheet } from "~/components/route-sheet";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { formatAccraDate, formatAccraDateTime, formatCount, formatPesewas } from "~/lib/format";
import type { PriceChange } from "~/lib/hire-purchase";
import { requireCounter, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/inventory-prices";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `Price history · ${loaderData?.item.name ?? "Item"} · Yadah Dynamic Enterprise`,
    },
  ];
}

/**
 * Why this item's cost or selling price moved, newest first.
 *
 * The shelf carries one current price, which is what the till charges and what
 * stock is valued at. That single number answers "what is it worth now" and
 * destroys the answer to "why did it change" — a delivery invoiced at a new
 * cost silently revalues every unit already on the shelf. These rows are what
 * make that readable afterwards, and the delivery ones name the invoice.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const [list, history] = await Promise.all([
        listItems(token, { limit: 100 }),
        listPriceChanges(token, params.id, { limit: 50 }),
      ]);
      const item = list.items.find((candidate) => candidate.id === params.id);
      if (!item) throw new Response("No such item.", { status: 404 });
      return { item, history };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data({ item: result.item, changes: result.history.items }, { headers });
}

export default function InventoryPrices({ loaderData }: Route.ComponentProps) {
  const { item, changes } = loaderData;

  return (
    <RouteSheet backTo="/inventory" title="Price history" description={item.name}>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <dl className="mb-5 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <dt className="eyebrow text-muted-foreground">Costs now</dt>
            <dd className="tabular mt-0.5 font-semibold">
              {formatPesewas(item.costPrice)}
            </dd>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <dt className="eyebrow text-muted-foreground">Sells for</dt>
            <dd className="tabular mt-0.5 font-semibold">
              {formatPesewas(item.sellingPrice)}
            </dd>
          </div>
        </dl>

        {changes.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HistoryIcon />
              </EmptyMedia>
              <EmptyTitle>Neither price has moved</EmptyTitle>
              <EmptyDescription>
                Every change made from the item, a delivery, or the bulk
                importer is recorded here with what it was before.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ol className="space-y-3">
            {changes.map((change) => (
              <ChangeRow key={change.id} change={change} />
            ))}
          </ol>
        )}

        <p className="mt-5 text-xs text-muted-foreground">
          Past sales and agreements keep the price they were written at, whatever
          happens here.{" "}
          <Link
            to={`/inventory/${item.id}/receive`}
            className="underline underline-offset-4"
          >
            Receive stock
          </Link>{" "}
          to book a delivery at a new cost.
        </p>
      </div>
    </RouteSheet>
  );
}

function ChangeRow({ change }: { change: PriceChange }) {
  const up = change.delta > 0;
  const delivery = change.quantityReceived != null;

  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="eyebrow text-muted-foreground">
          {change.kind === "cost" ? "Cost" : "Selling"}
        </span>
        <span className="tabular text-muted-foreground line-through">
          {formatPesewas(change.previous)}
        </span>
        {up ? (
          <ArrowUpRightIcon className="size-3.5 shrink-0 self-center text-cash-out" />
        ) : (
          <ArrowDownRightIcon className="size-3.5 shrink-0 self-center text-cash-in" />
        )}
        <span className="tabular font-semibold">{formatPesewas(change.current)}</span>
        <span
          className={cn("tabular text-xs", up ? "text-cash-out" : "text-cash-in")}
        >
          {up ? "+" : "−"}
          {formatPesewas(Math.abs(change.delta))}
        </span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {delivery ? (
          <>
            {formatCount(change.quantityReceived ?? 0)} received
            {change.supplier ? ` from ${change.supplier}` : ""}
            {change.invoiceRef ? ` · ${change.invoiceRef}` : ""}
            {change.receivedOn ? ` · ${formatAccraDate(change.receivedOn)}` : ""}
          </>
        ) : (
          (change.reason ?? "Changed on the item")
        )}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {change.changedByName ?? "Staff"} · {formatAccraDateTime(change.createdAt)}
      </p>
    </li>
  );
}
