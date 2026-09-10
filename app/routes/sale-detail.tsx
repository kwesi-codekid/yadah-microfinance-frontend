import { PrinterIcon, ShoppingCartIcon, XCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Link, useFetcher } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { getSale, voidSale } from "~/api/sales";
import { Figure, StatusPill, Th } from "~/components/listing";
import { BackLink, Page } from "~/components/page";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { formatAccraDateTime, formatCount, formatPesewas } from "~/lib/format";
import {
  CHANNEL_LABELS,
  SALE_STATUS_BLURBS,
  SALE_STATUS_LABELS,
  SALE_STATUS_TONE,
  canVoid,
  isWalkIn,
  unitCount,
} from "~/lib/sales";
import { isOffice } from "~/lib/auth";
import { requireCounter, requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/sale-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  const no = loaderData?.sale.receiptNo ?? "Sale";
  return [{ title: `Receipt ${no} · Yadah Dynamic Enterprise` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireCounter(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      return await getSale(token, params.id);
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  // Ringing a sale up is counter work; unpicking one is not.
  return data({ sale: result.sale, canDecide: isOffice(viewer) }, { headers });
}

interface ActionResult {
  ok: boolean;
  message: string;
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const reason = String(form.get("reason") ?? "").trim();

  if (!reason) {
    return data<ActionResult>(
      { ok: false, message: "Say why it is being voided." },
      { status: 400 },
    );
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      voidSale(token, params.id, reason),
    );
    return data<ActionResult>(
      {
        ok: true,
        message: `Receipt ${result.sale.receiptNo} voided. Stock went back.`,
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data<ActionResult>(
        { ok: false, message: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}

export default function SaleDetail({ loaderData }: Route.ComponentProps) {
  const { sale, canDecide } = loaderData;
  const fetcher = useFetcher<ActionResult>();
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) toast.success(fetcher.data.message);
    else toast.error(fetcher.data.message);
  }, [fetcher.data]);

  const voided = sale.status === "voided";
  const units = unitCount(sale);

  return (
    <Page>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <BackLink to="/sales">All sales</BackLink>

        <div className="min-w-0 text-right">
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            <h2 className="font-heading tabular truncate text-2xl font-bold tracking-tight">
              {sale.receiptNo}
            </h2>
            <StatusPill
              label={SALE_STATUS_LABELS[sale.status]}
              blurb={SALE_STATUS_BLURBS[sale.status]}
              tone={SALE_STATUS_TONE[sale.status]}
            />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatAccraDateTime(sale.createdAt)} ·{" "}
            {CHANNEL_LABELS[sale.channel] ?? sale.channel}
          </p>
        </div>
      </header>

      {voided && (
        <p className="mb-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>
            <span className="font-medium">This sale was voided</span>
            {sale.voidedAt
              ? ` on ${formatAccraDateTime(sale.voidedAt)}`
              : ""}. {sale.voidReason || "No reason was recorded."} The stock
            went back and it no longer counts toward revenue.
          </span>
        </p>
      )}

      <section className="mb-6 rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Buyer
        </h3>
        {sale.customerId ? (
          <Link
            to={`/customers/${sale.customerId}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {sale.buyerName}
          </Link>
        ) : (
          <p className="font-medium">{sale.buyerName}</p>
        )}
        <p className="mt-0.5 text-sm text-muted-foreground">
          {isWalkIn(sale)
            ? "Walk-in — not on the books"
            : "Registered customer"}
          {sale.buyerPhone ? ` · ${sale.buyerPhone}` : ""}
        </p>
      </section>

      <section className="mb-6 overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Basket
          </h3>
          <div className="flex items-center gap-2">
            {/* A resource route answering with bytes — a plain anchor, so the
                router does not try to navigate to it. A voided sale still
                prints, stamped, which is why this is always offered. */}
            <Button asChild variant="outline" size="sm">
              <a href={`/sales/${sale.id}/receipt`}>
                <PrinterIcon />
                Print receipt
              </a>
            </Button>
            {canDecide && canVoid(sale) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  setReason("");
                  setConfirmVoid(true);
                }}
              >
                <XCircleIcon />
                Void
              </Button>
            )}
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <Th>Item</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">List</Th>
              <Th className="text-right">Charged</Th>
              <Th className="text-right">Line</Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sale.lines.map((line, i) => {
              const cut = line.unitPrice < line.listPrice;
              return (
                <TableRow key={`${line.itemId}-${i}`}>
                  <TableCell className="px-4 py-3 font-medium">
                    {line.name}
                  </TableCell>
                  <TableCell className="tabular px-4 py-3 text-right">
                    {formatCount(line.quantity)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "tabular px-4 py-3 text-right text-muted-foreground",
                      cut && "line-through",
                    )}
                  >
                    {formatPesewas(line.listPrice)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "tabular px-4 py-3 text-right",
                      cut && "font-medium text-warning",
                    )}
                  >
                    {formatPesewas(line.unitPrice)}
                  </TableCell>
                  <TableCell className="tabular px-4 py-3 text-right font-semibold">
                    {formatPesewas(line.lineTotal)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      <dl className="grid gap-3 sm:grid-cols-4">
        <Figure label="Units" value={formatCount(units)} />
        <Figure
          label="Subtotal"
          value={formatPesewas(sale.subtotal)}
          tone="muted"
        />
        <Figure
          label="Discount"
          value={sale.discount > 0 ? `−${formatPesewas(sale.discount)}` : "—"}
          tone={sale.discount > 0 ? "warning" : "muted"}
        />
        <Figure
          label="Total"
          value={formatPesewas(sale.total)}
          tone={voided ? "muted" : "success"}
        />
      </dl>

      <AlertDialog open={confirmVoid} onOpenChange={setConfirmVoid}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void receipt {sale.receiptNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              The {formatCount(units)} unit{units === 1 ? "" : "s"} go back on
              the shelf and the {formatPesewas(sale.total)} stops counting
              toward revenue. The sale stays on the record, stamped with your
              name and this reason. There is no undo.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5">
            <Label
              htmlFor="void-reason"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Why<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="void-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Wrong item rung up"
              maxLength={200}
              autoComplete="off"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={!reason.trim()}
              onClick={() => {
                setConfirmVoid(false);
                fetcher.submit({ reason: reason.trim() }, { method: "post" });
              }}
            >
              Void the sale
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {sale.lines.length === 0 && (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <ShoppingCartIcon className="size-4" />
          This sale has no lines on it.
        </p>
      )}
    </Page>
  );
}
