import {
  BanknoteArrowDownIcon,
  CheckIcon,
  MoreHorizontalIcon,
  PackageXIcon,
  PrinterIcon,
  RotateCcwIcon,
  SmartphoneIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UndoDotIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { data, Link, Outlet, useFetcher } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { getCustomer } from "~/api/customers";
import { ApiError } from "~/api/error";
import {
  approveAgreement,
  forfeit,
  getAgreement,
  markArrears,
  redeem,
  rejectAgreement,
  repossess,
  trashAgreement,
} from "~/api/hire-purchase";
import { Figure, StatusPill, Th } from "~/components/listing";
import { BackLink, Page } from "~/components/page";
import { SignatureCard } from "~/components/signature-card";
import { LifecycleStrip, RedemptionCountdown } from "~/components/redemption";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";
import {
  formatAccraDate,
  formatAccraDateTime,
  formatAmount,
  formatPesewas,
  parseCedis,
  toCedisInput,
} from "~/lib/format";
import {
  AGREEMENT_STATUS_BLURBS,
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_STATUS_TONE,
  CHANNEL_LABELS,
  PAYMENT_TYPE_LABELS,
  awaitingApproval,
  awaitingDeposit,
  canTrashAgreement,
  isRedeemable,
  isRunning,
  paymentProgress,
  windowLapsed,
} from "~/lib/hire-purchase";
import { newIdempotencyKey } from "~/lib/idempotency";
import { isOffice } from "~/lib/auth";
import { requireCounter, requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/hp-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.customerName ?? "Agreement";
  return [{ title: `${name} · Hire purchase · Yadah Dynamic Enterprise` }];
}

// The counter reads an agreement to take a payment against it. Rejecting,
// repossessing and forfeiting live in the action below, which stays office.
export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireCounter(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const detail = await getAgreement(token, params.id);
      const customer = await getCustomer(token, detail.agreement.customerId)
        .then((r) => r.customer)
        .catch(() => null);
      return { detail, customer };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  const { agreement } = result.detail;

  return data(
    {
      agreement,
      /** Rejecting, repossessing and forfeiting are the office's, not the counter's. */
      canDecide: isOffice(viewer),
      customerName:
        result.customer?.fullName ?? agreement.customerName ?? "Customer",
      payments: (result.detail.payments ?? []).map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        what: payment.type
          ? (PAYMENT_TYPE_LABELS[payment.type] ?? payment.type)
          : "Payment",
        how: payment.channel
          ? (CHANNEL_LABELS[payment.channel] ?? payment.channel)
          : (payment.source ?? "—"),
        at: formatAccraDateTime(payment.createdAt),
      })),
    },
    { headers },
  );
}

/** Opening the payment drawer does not re-read the agreement underneath it. */
export const shouldRevalidate = drawerParentShouldRevalidate;

interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Everything that changes an agreement's state but does not take a typed
 * amount: approve, reject, flag arrears, repossess, redeem, forfeit, trash.
 *
 * Redemption is here rather than in a drawer because it has nothing to fill in
 * — the API computes the full remaining balance itself and returns it. It still
 * carries an idempotency key: it moves money, and a retry must not charge the
 * customer for the same fridge twice.
 */
export async function action({ request, params }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const reason = String(form.get("reason") ?? "").trim();

  if ((intent === "reject" || intent === "repossess") && !reason) {
    return data<ActionResult>(
      { ok: false, message: "A reason is required and is kept on the record." },
      { status: 400 },
    );
  }

  try {
    const { data: result, headers } = await withAuth(request, async (token) => {
      if (intent === "approve") {
        await approveAgreement(token, params.id);
        return {
          message:
            "Approved. The customer has been sent the terms and the deposit can now be taken.",
          gone: false,
        };
      }
      if (intent === "reject") {
        await rejectAgreement(token, params.id, reason);
        return {
          message: "Agreement rejected. The unit is back on the shelf.",
          gone: false,
        };
      }
      if (intent === "mark-arrears") {
        await markArrears(token, params.id);
        return {
          message:
            "Flagged as in arrears. The customer has been warned by SMS.",
          gone: false,
        };
      }
      if (intent === "repossess") {
        await repossess(token, params.id, reason);
        return {
          message:
            "Repossession recorded. The one-month redemption window is open.",
          gone: false,
        };
      }
      if (intent === "redeem") {
        const { amount } = await redeem(token, params.id, {
          idempotencyKey: String(form.get("idempotencyKey") ?? ""),
        });
        return {
          message: `Redeemed for ${formatPesewas(amount)}. The item is the customer's.`,
          gone: false,
        };
      }
      if (intent === "forfeit") {
        const costPrice = parseCedis(
          String(form.get("costPrice") ?? "").trim(),
        );
        const sellingPrice = parseCedis(
          String(form.get("sellingPrice") ?? "").trim(),
        );
        const restock =
          form.get("restock") === "1" &&
          costPrice != null &&
          sellingPrice != null
            ? {
                costPrice,
                sellingPrice,
                name: String(form.get("restockName") ?? "").trim() || undefined,
              }
            : undefined;
        const outcome = await forfeit(token, params.id, restock);
        return {
          message: outcome.restockedItem
            ? "Forfeited, and the item is back on the shelf as used."
            : "Forfeited. The item and the payments stay with Yadah.",
          gone: false,
        };
      }
      if (intent === "trash") {
        await trashAgreement(token, params.id, reason || undefined);
        return { message: "Agreement moved to the trash.", gone: true };
      }
      throw new Response("Unknown action.", { status: 400 });
    });

    if (result.gone) {
      await redirectWithToast(
        "/hire-purchase",
        { tone: "success", message: result.message },
        headers,
      );
    }
    return data<ActionResult>(
      { ok: true, message: result.message },
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

export default function HpDetail({ loaderData }: Route.ComponentProps) {
  const { agreement, canDecide, customerName, payments } = loaderData;

  const awaiting = awaitingDeposit(agreement);
  const unapproved = awaitingApproval(agreement);
  const running = isRunning(agreement);
  const repossessed = agreement.status === "repossessed";
  // Only while the window after a repossession is still open — buying the item
  // back is the third thing a wallet can be charged for on this page.
  const redeemable = isRedeemable(agreement);
  const progress = paymentProgress(agreement);

  return (
    <Page className="max-w-none">
      <BackLink to="/hire-purchase" className="mb-4">
        All agreements
      </BackLink>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-heading text-2xl font-bold tracking-tight">
              {customerName}
            </h2>
            <StatusPill
              label={AGREEMENT_STATUS_LABELS[agreement.status]}
              blurb={AGREEMENT_STATUS_BLURBS[agreement.status]}
              tone={AGREEMENT_STATUS_TONE[agreement.status]}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {agreement.item.name} · {agreement.durationMonths} months ·{" "}
            {formatPesewas(agreement.item.sellingPrice)} · signed{" "}
            {formatAccraDate(agreement.createdAt)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Whichever of the three charge kinds this agreement is owed — the
              deposit, an instalment, or a redemption inside the window — the
              drawer works it out from the state rather than being told. */}
          {(awaiting || running || redeemable) && (
            <Button asChild variant="outline">
              <Link
                to={`/hire-purchase/${agreement.id}/charge`}
                prefetch="intent"
                preventScrollReset
              >
                <SmartphoneIcon />
                Mobile money
              </Link>
            </Button>
          )}
          {(awaiting || running) && (
            <Button asChild>
              <Link
                to={`/hire-purchase/${agreement.id}/pay`}
                prefetch="intent"
                preventScrollReset
              >
                <BanknoteArrowDownIcon />
                {awaiting ? "Record deposit" : "Record payment"}
              </Link>
            </Button>
          )}
          {/* The one decision that is the point of the page while it is in this
              state, so it is a button rather than a line in the ⋯ menu. */}
          {canDecide && unapproved && (
            <ApproveButton customerName={customerName} />
          )}
          {/* Every item in it decides something, so the counter is not shown a
              menu whose every entry would be refused. */}
          {canDecide && (
            <AgreementMenu agreement={agreement} customerName={customerName} />
          )}
        </div>
      </header>

      <LifecycleStrip status={agreement.status} className="mb-6" />

      {/* The clock the whole repossession lifecycle turns on. It sits directly
          under the strip because it is what decides which of the two
          irreversible endings is available today. */}
      {repossessed && agreement.redemptionDeadline && (
        <RedemptionCountdown
          deadline={agreement.redemptionDeadline}
          className="mb-6"
        />
      )}

      {agreement.repossessionReason && (
        <Note tone="muted">
          <span className="font-medium">Repossessed:</span>{" "}
          {agreement.repossessionReason}
        </Note>
      )}

      {agreement.rejectionReason && (
        <Note tone="muted">
          <span className="font-medium">Rejected:</span>{" "}
          {agreement.rejectionReason}
        </Note>
      )}

      {agreement.status === "in-arrears" && (
        <Note tone="warning">
          <span className="font-medium">Behind on instalments.</span> Clearing
          the overdue ones lifts this.
        </Note>
      )}

      {unapproved && (
        <Note tone="warning">
          <span className="font-medium">Signed at the counter.</span> A manager
          has to approve it before a deposit can be taken.
        </Note>
      )}

      {awaiting && (
        <Note tone="info">
          <span className="font-medium">
            Waiting on {formatPesewas(agreement.depositRequired)}.
          </span>{" "}
          The item stays in the shop until it is paid.
        </Note>
      )}

      <section className="mb-6 rounded-xl border border-border bg-card p-4">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label="Selling price"
            value={formatPesewas(agreement.item.sellingPrice)}
          />
          <Figure
            label="Deposit"
            value={formatPesewas(agreement.depositRequired)}
            tone={agreement.itemReleasedAt ? "success" : "warning"}
            hint={
              agreement.itemReleasedAt
                ? `Paid ${formatAccraDate(agreement.itemReleasedAt)}`
                : "Not yet paid"
            }
          />
          <Figure
            label="Paid so far"
            value={formatPesewas(agreement.totalPaid)}
            hint={
              agreement.totalPayable
                ? `of ${formatPesewas(agreement.totalPayable)} payable`
                : "Set at activation"
            }
          />
          <Figure
            label="Still owing"
            value={formatPesewas(agreement.remaining)}
            tone={agreement.remaining > 0 ? "warning" : "muted"}
            hint={`${agreement.interestRatePercent}% flat interest, applied once`}
          />
        </dl>

        {agreement.totalPayable ? (
          <div className="mt-4 space-y-2">
            <div
              className="flex h-2 overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`${Math.round(progress * 100)}% paid`}
            >
              <div
                className={cn(
                  "h-full transition-[width]",
                  agreement.status === "in-arrears"
                    ? "bg-warning"
                    : "bg-primary",
                )}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {Math.round(progress * 100)}% of the financed half paid.
            </p>
          </div>
        ) : null}
      </section>

      {agreement.signatureUrl && <SignatureCard url={agreement.signatureUrl} />}

      <Payments agreementId={agreement.id} rows={payments} />

      {/* The payment drawer renders here, over the agreement. */}
      <Outlet />
    </Page>
  );
}

/* ---------------------------------------------------------------- approve --- */

/**
 * The office letting a counter-signed agreement stand.
 *
 * It is its own control rather than an entry in the ⋯ menu because while an
 * agreement is `awaiting-approval` this is the only thing anybody can do with
 * it — nothing may be charged against it, and it is a manager's queue. The
 * confirmation is worth a click: approving sends the customer the terms by SMS
 * and there is no un-approving afterwards, only rejecting.
 */
function ApproveButton({ customerName }: { customerName: string }) {
  const fetcher = useFetcher<ActionResult>();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) toast.success(fetcher.data.message);
    else toast.error(fetcher.data.message);
  }, [fetcher.data]);

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={fetcher.state !== "idle"}>
        <CheckIcon />
        Approve
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Approve this agreement?"
        description={`${customerName} is sent the terms by SMS and the deposit can be taken. This cannot be undone.`}
        confirmLabel="Approve"
        onConfirm={() =>
          fetcher.submit({ intent: "approve" }, { method: "post" })
        }
      />
    </>
  );
}

/* --------------------------------------------------------------- payments --- */

/**
 * Every payment against the agreement — deposit, instalments, redemption — as
 * the API sends them. Each row carries a ⋯ menu with its receipt: a resource
 * route answering with bytes, so a plain anchor rather than a `Link`.
 */
function Payments({
  agreementId,
  rows,
}: {
  agreementId: string;
  rows: { id: string; amount: number; what: string; how: string; at: string }[];
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h3 className="font-heading font-bold tracking-tight">Payments</h3>
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing has been paid against this agreement yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <Th>When</Th>
              <Th>What</Th>
              <Th className="hidden sm:table-cell">How</Th>
              <Th className="text-right">Amount</Th>
              <Th className="text-right">
                <span className="sr-only">Actions</span>
              </Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="px-4 py-3 whitespace-nowrap">
                  {row.at}
                </TableCell>
                <TableCell className="px-4 py-3">{row.what}</TableCell>
                <TableCell className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                  {row.how}
                </TableCell>
                <TableCell className="tabular px-4 py-3 text-right font-medium whitespace-nowrap text-cash-in">
                  +{formatAmount(row.amount)}
                </TableCell>
                <TableCell className="px-4 py-3 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Actions"
                        className="text-muted-foreground"
                      >
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem asChild>
                        <a
                          href={`/hire-purchase/${agreementId}/payments/${row.id}/receipt`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <PrinterIcon />
                          Print receipt
                        </a>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- menu --- */

type Agreement = Route.ComponentProps["loaderData"]["agreement"];

/**
 * Every state-changing action on one agreement.
 *
 * Which ones are usable is decided entirely by where the agreement is in its
 * lifecycle, and the ones that are not stay in the menu, disabled — a menu
 * whose items appear and disappear teaches nobody what the sequence is.
 */
function AgreementMenu({
  agreement,
  customerName,
}: {
  agreement: Agreement;
  customerName: string;
}) {
  const fetcher = useFetcher<ActionResult>();
  const [dialog, setDialog] = useState<
    "reject" | "arrears" | "repossess" | "redeem" | "forfeit" | "trash" | null
  >(null);

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) toast.success(fetcher.data.message);
    else toast.error(fetcher.data.message);
  }, [fetcher.data]);

  const awaiting = awaitingDeposit(agreement);
  const unapproved = awaitingApproval(agreement);
  const running = isRunning(agreement);
  const redeemable = isRedeemable(agreement);
  const lapsed = windowLapsed(agreement);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon">
            <MoreHorizontalIcon />
            <span className="sr-only">More actions for this agreement</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {/* Turning one down is the same act either side of approval: nothing
              has been paid in either state, and the unit goes back either way. */}
          <DropdownMenuItem
            disabled={!awaiting && !unapproved}
            onSelect={(event) => {
              event.preventDefault();
              setDialog("reject");
            }}
          >
            <XIcon />
            Reject application
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            disabled={agreement.status !== "active"}
            onSelect={(event) => {
              event.preventDefault();
              setDialog("arrears");
            }}
          >
            <TriangleAlertIcon />
            Flag as in arrears
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!running}
            onSelect={(event) => {
              event.preventDefault();
              setDialog("repossess");
            }}
          >
            <UndoDotIcon />
            Record a repossession
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            disabled={!redeemable}
            onSelect={(event) => {
              event.preventDefault();
              setDialog("redeem");
            }}
          >
            <RotateCcwIcon />
            Redeem the item
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!lapsed}
            onSelect={(event) => {
              event.preventDefault();
              setDialog("forfeit");
            }}
          >
            <PackageXIcon />
            Close as forfeited
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem asChild>
            <Link to={`/customers/${agreement.customerId}`}>
              <UserIcon />
              Customer
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canTrashAgreement(agreement)}
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              setDialog("trash");
            }}
          >
            <Trash2Icon />
            Move to trash
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ReasonDialog
        open={dialog === "reject"}
        onOpenChange={(next) => setDialog(next ? "reject" : null)}
        title="Reject this agreement?"
        description="No money has moved. The unit goes back on the shelf."
        placeholder="Customer changed their mind."
        confirmLabel="Reject"
        destructive
        onConfirm={(reason) =>
          fetcher.submit({ intent: "reject", reason }, { method: "post" })
        }
      />

      <ConfirmDialog
        open={dialog === "arrears"}
        onOpenChange={(next) => setDialog(next ? "arrears" : null)}
        title="Flag this agreement as in arrears?"
        description={`${customerName} is sent an arrears-warning SMS.`}
        confirmLabel="Flag as in arrears"
        onConfirm={() =>
          fetcher.submit({ intent: "mark-arrears" }, { method: "post" })
        }
      />

      <ReasonDialog
        open={dialog === "repossess"}
        onOpenChange={(next) => setDialog(next ? "repossess" : null)}
        title="Record a repossession?"
        description="Payments so far are kept. The customer has one month to redeem it by paying the full balance."
        placeholder="Three instalments missed; item collected."
        confirmLabel="Record repossession"
        destructive
        onConfirm={(reason) =>
          fetcher.submit({ intent: "repossess", reason }, { method: "post" })
        }
      />

      <RedeemDialog
        open={dialog === "redeem"}
        onOpenChange={(next) => setDialog(next ? "redeem" : null)}
        remaining={agreement.remaining}
        onConfirm={(idempotencyKey) =>
          fetcher.submit(
            { intent: "redeem", idempotencyKey },
            { method: "post" },
          )
        }
      />

      <ForfeitDialog
        open={dialog === "forfeit"}
        onOpenChange={(next) => setDialog(next ? "forfeit" : null)}
        itemName={agreement.item.name}
        sellingPrice={agreement.item.sellingPrice}
        onConfirm={(payload) =>
          fetcher.submit({ intent: "forfeit", ...payload }, { method: "post" })
        }
      />

      <ReasonDialog
        open={dialog === "trash"}
        onOpenChange={(next) => setDialog(next ? "trash" : null)}
        title="Move this agreement to the trash?"
        description="The unit goes back on the shelf. It can be restored from Trash."
        placeholder="Signed in error."
        confirmLabel="Move to trash"
        optional
        destructive
        onConfirm={(reason) =>
          fetcher.submit({ intent: "trash", reason }, { method: "post" })
        }
      />
    </>
  );
}

/* ---------------------------------------------------------------- dialogs --- */

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(
              destructive &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  confirmLabel,
  optional,
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  description: string;
  placeholder: string;
  confirmLabel: string;
  optional?: boolean;
  destructive?: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("");
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="dialog-reason" className="text-sm font-medium">
            Reason{" "}
            {optional && (
              <span className="text-muted-foreground">(optional)</span>
            )}
          </Label>
          <Textarea
            id="dialog-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder={placeholder}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!optional && !reason.trim()}
            onClick={() => onConfirm(reason)}
            className={cn(
              destructive &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Redemption asks for nothing except a decision: the API computes the full
 * remaining balance itself. The figure is still shown, because someone has to
 * take that much cash over the counter before pressing this.
 */
function RedeemDialog({
  open,
  onOpenChange,
  remaining,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  remaining: number;
  onConfirm: (idempotencyKey: string) => void;
}) {
  // Minted once per mount and reused: a double click on a redemption must not
  // charge the customer twice.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Redeem this item?</AlertDialogTitle>
          <AlertDialogDescription>
            The full remaining balance. Take the cash before confirming.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Figure
          label="To collect"
          value={formatPesewas(remaining)}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(idempotencyKey)}>
            Redeem for {formatPesewas(remaining)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Forfeiture ends the agreement and hands the item and every payment to Yadah.
 * The item can go back on the shelf in the same move — as **used**, at a price
 * the office sets now. A returned fridge is not worth what a new one is and the
 * API will not guess, so the prices are asked for here or not at all.
 */
function ForfeitDialog({
  open,
  onOpenChange,
  itemName,
  sellingPrice,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  itemName: string;
  sellingPrice: number;
  onConfirm: (payload: Record<string, string>) => void;
}) {
  const [restock, setRestock] = useState(false);
  const [cost, setCost] = useState("");
  const [selling, setSelling] = useState("");

  const costPesewas = parseCedis(cost);
  const sellingPesewas = parseCedis(selling);
  const ready =
    !restock ||
    (costPesewas != null &&
      costPesewas >= 0 &&
      sellingPesewas != null &&
      sellingPesewas > 0);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setRestock(false);
          setCost("");
          setSelling("");
        }
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close as forfeited?</AlertDialogTitle>
          <AlertDialogDescription>
            The item and everything paid towards it stay with Yadah. This
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <label className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
          <input
            type="checkbox"
            checked={restock}
            onChange={(event) => {
              setRestock(event.target.checked);
              if (event.target.checked && !selling) {
                // A sensible starting point, not a recommendation: the office
                // sets the used price, and it is almost never the new one.
                setSelling(toCedisInput(Math.round(sellingPrice * 0.7)));
              }
            }}
            className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              Put {itemName} back on the shelf as used
            </span>
            <span className="block text-xs text-muted-foreground">
              It returns as a separate item at a used price, so the new-stock
              figures stay honest.
            </span>
          </span>
        </label>

        {restock && (
          <div className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="restock" value="1" />
            <div className="space-y-1.5">
              <Label htmlFor="forfeit-cost" className="text-sm font-medium">
                Cost price · GH₵
              </Label>
              <Input
                id="forfeit-cost"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="forfeit-selling" className="text-sm font-medium">
                Used selling price · GH₵
              </Label>
              <Input
                id="forfeit-selling"
                value={selling}
                onChange={(event) => setSelling(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="tabular"
              />
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!ready}
            onClick={() =>
              onConfirm(
                restock
                  ? {
                      restock: "1",
                      costPrice: cost,
                      sellingPrice: selling,
                      restockName: `${itemName} (used)`,
                    }
                  : {},
              )
            }
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Forfeit{restock ? " and restock" : ""}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* -------------------------------------------------------------------- note --- */

function Note({
  tone,
  children,
}: {
  tone: "warning" | "info" | "muted";
  children: ReactNode;
}) {
  return (
    <div
      role="note"
      className={cn(
        "mb-6 rounded-lg border px-4 py-3 text-sm",
        tone === "warning" && "border-warning/40 bg-warning/10",
        tone === "info" && "border-info/40 bg-info/10",
        tone === "muted" && "border-border bg-muted/40",
      )}
    >
      {children}
    </div>
  );
}
