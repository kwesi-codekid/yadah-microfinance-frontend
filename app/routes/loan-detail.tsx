import {
  AlertTriangleIcon,
  BanknoteArrowDownIcon,
  BanknoteIcon,
  CheckIcon,
  CoinsIcon,
  HandCoinsIcon,
  MoreHorizontalIcon,
  PiggyBankIcon,
  PrinterIcon,
  SmartphoneIcon,
  Trash2Icon,
  UserIcon,
  WalletIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { data, Link, Outlet, useFetcher } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import {
  approveCorrection,
  cancelCorrection,
  correctTransaction,
  listCorrections,
  proposeCorrection,
  rejectCorrection,
} from "~/api/corrections";
import { getCustomer } from "~/api/customers";
import { ApiError } from "~/api/error";
import {
  approve,
  getConfig,
  getEligibility,
  getLoan,
  reject,
  trashLoan,
} from "~/api/loans";
import { listUsers } from "~/api/users";
import { StatusPill, Th } from "~/components/listing";
import { Page } from "~/components/page";
import {
  TxnRowMenu,
  toPending,
  whyNotCorrectable,
  type CorrectionOutcome,
  type PendingCorrection,
} from "~/components/txn-correction";
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
import { Label } from "~/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";
import { isOffice } from "~/lib/auth";
import type { CorrectionKind } from "~/lib/corrections";
import { hasIdDocument } from "~/lib/customers";
import {
  accraDay,
  formatAccraDate,
  formatAccraDateTime,
  formatAmount,
  formatCount,
  formatPesewas,
  parseCedis,
} from "~/lib/format";
import {
  LOAN_STATUS_LABELS,
  LOAN_STATUS_TONE,
  SOURCE_LABELS,
  canReturnCollateral,
  canTrash,
  daysOverdue,
  isOpen,
  isPending,
  rateFor,
  withDefaults,
  type LoanEligibility,
} from "~/lib/loans";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Crumb } from "./app-layout";
import type { Route } from "./+types/loan-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.customerName ?? "Loan";
  return [{ title: `${name}'s loan · Yadah Dynamic Enterprise` }];
}

/** The trail the layout header shows: the book, then whose loan this is. */
export const handle = {
  crumbs: (data: unknown): Crumb[] => [
    { label: "Loans", to: "/loans" },
    { label: (data as { customerName?: string } | undefined)?.customerName ?? "Loan" },
  ],
};

// The counter reads a loan to take a repayment against it. Approving and
// rejecting live in the action below, which stays office.
export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireCounter(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const detail = await getLoan(token, params.id);
      const [customer, config, staff, eligibility, corrections] = await Promise.all([
        getCustomer(token, detail.loan.customerId)
          .then((r) => r.customer)
          .catch(() => null),
        // What the rate *would* be today for this duration. On an escalated
        // loan that is the only way to show what it started at.
        getConfig(token)
          .then((r) => r.config)
          .catch(() => null),
        // A repayment names whoever recorded it by id and nothing else.
        listUsers(token, { limit: 100 }).catch(() => null),
        // Only for an application still waiting on someone. Once it is decided,
        // the history is no longer what the page is for.
        isPending(detail.loan)
          ? getEligibility(token, detail.loan.customerId).catch(() => null)
          : Promise.resolve(null),
        // Corrections asked for on this loan and not yet answered, so a row
        // can say one is waiting. Soft: the loan must not go down with it.
        listCorrections(token, {
          targetId: params.id,
          status: "pending",
          limit: 100,
        }).catch(() => null),
      ]);
      return { detail, customer, config, staff, eligibility, corrections };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  const { loan, schedule, repayments } = result.detail;
  const names = new Map<string, string>(
    result.staff?.items.map((u) => [u.id, u.name]) ?? [],
  );
  const config = withDefaults(result.config);
  const today = accraDay();
  // One open request per repayment is the API's rule, so a map by repayment
  // holds everything a row needs to say about it.
  const pending = new Map<string, PendingCorrection>(
    result.corrections?.items.map((c) => [c.txnId, toPending(c, viewer.id)]) ??
      [],
  );

  // What was still owed once each repayment had landed. The API sends the
  // newest first, so the running total is built from the far end; the newest
  // row's balance is the loan's remaining figure.
  const balanceAfter = new Map<string, number>();
  let owed = loan.totalDue;
  for (const r of [...repayments].reverse()) {
    owed -= r.amount;
    balanceAfter.set(r.id, owed);
  }

  return data(
    {
      loan,
      /** Approving, rejecting and deciding a correction are the office's. */
      canDecide: isOffice(viewer),
      userId: viewer.id,
      customerName:
        result.customer?.fullName ?? loan.customerName ?? "Customer",
      // Fallbacks for when the eligibility read fails: the record itself says
      // whether the ID is there. An unreadable record does not block — the API
      // refuses approval without one either way. Any ID type counts.
      customerHasId: result.customer
        ? Boolean(result.customer.identification?.idNumber)
        : true,
      customerHasIdDocument: result.customer
        ? hasIdDocument(result.customer)
        : true,
      eligibility: result.eligibility,
      /** The rate this duration carries under today's config. */
      standardRate: rateFor(config, loan.durationMonths),
      overdue: daysOverdue(
        loan.dueDate ? accraDay(new Date(loan.dueDate)) : null,
        today,
      ),
      schedule: schedule.map((row) => ({
        ...row,
        due: formatAccraDate(row.dueDate),
        overdue: daysOverdue(accraDay(new Date(row.dueDate)), today),
      })),
      repayments: repayments.map((r) => ({
        id: r.id,
        amount: r.amount,
        balance: balanceAfter.get(r.id) ?? 0,
        source: SOURCE_LABELS[r.source] ?? r.source,
        at: r.createdAt ? formatAccraDateTime(r.createdAt) : "—",
        recordedBy: r.recordedById
          ? (names.get(r.recordedById) ?? "Staff")
          : "System",
        // Why this one can never be corrected, or null. Only cash typed at
        // the counter has a data-entry mistake in it to correct.
        locked:
          r.source === "susu" || r.source === "susu-closure"
            ? "This was paid from a susu account. It cannot be changed on its own."
            : r.source === "loan-savings"
              ? "This was paid from the loan savings account. It cannot be changed on its own."
              : r.source === "transfer"
              ? "This came from a transfer between accounts. Correct it on the transfer, not here."
              : r.channel === "paystack"
                ? "This was paid through Paystack, so the amount is what was charged."
                : null,
        pending: pending.get(r.id) ?? null,
      })),
    },
    { headers },
  );
}

/** Opening a repayment drawer does not re-read the loan underneath it. */
export const shouldRevalidate = drawerParentShouldRevalidate;

type ActionResult = CorrectionOutcome;

/** What only the office may post here. The API refuses these too. */
const OFFICE_INTENTS = new Set([
  "approve",
  "reject",
  "trash",
  "correct-txn",
  "approve-correction",
  "reject-correction",
]);

/**
 * Approve, reject and trash, and the corrections on the repayments. Approving
 * is the one place in this module where money starts moving, so it locks the
 * rate and builds the schedule and then the loader re-reads the loan — the
 * page after an approval is a different page from the page before it. The
 * counter reaches this action only to ask for a correction, or take one back.
 */
export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireCounter(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const correctionId = String(form.get("correctionId") ?? "");
  // The shared correction dialogs name the entry they are about themselves.
  const kind = String(form.get("kind") ?? "") as CorrectionKind;
  const txnId = String(form.get("txnId") ?? "");

  if (OFFICE_INTENTS.has(intent) && !isOffice(user)) {
    return data<ActionResult>(
      { ok: false, message: "That is the office's to do." },
      { status: 403 },
    );
  }
  if (intent === "reject" && !reason) {
    return data<ActionResult>(
      { ok: false, message: "Say why it was turned down." },
      { status: 400 },
    );
  }

  try {
    const { data: result, headers } = await withAuth(request, async (token) => {
      if (intent === "approve") {
        await approve(token, params.id);
        return { message: "Loan approved. The schedule is set.", gone: false };
      }
      if (intent === "reject") {
        await reject(token, params.id, reason);
        return { message: "Application rejected.", gone: false };
      }
      if (intent === "trash") {
        await trashLoan(token, params.id, reason || undefined);
        return { message: "Application moved to the trash.", gone: true };
      }
      if (intent === "correct-txn" || intent === "propose-correction") {
        const amount = parseCedis(String(form.get("amount") ?? ""));
        if (amount == null || amount <= 0) {
          throw new Response("Enter the corrected amount.", { status: 400 });
        }
        if (intent === "correct-txn") {
          await correctTransaction(token, kind, params.id, txnId, amount);
          return { message: "Repayment corrected.", gone: false };
        }
        await proposeCorrection(token, kind, params.id, txnId, { amount, reason });
        return {
          message: "Sent to the office. Nothing changes until they answer.",
          gone: false,
        };
      }
      if (intent === "approve-correction") {
        const { correction } = await approveCorrection(token, correctionId);
        return {
          message: `Correction applied. The repayment is now GH₵ ${formatAmount(correction.amount)}.`,
          gone: false,
        };
      }
      if (intent === "reject-correction") {
        await rejectCorrection(token, correctionId, reason);
        return { message: "Correction declined. The repayment is unchanged.", gone: false };
      }
      if (intent === "cancel-correction") {
        await cancelCorrection(token, correctionId);
        return { message: "Request taken back.", gone: false };
      }
      throw new Response("Unknown action.", { status: 400 });
    });

    if (result.gone) {
      await redirectWithToast(
        "/loans",
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
        {
          ok: false,
          message: error.message,
          details:
            typeof error.details === "object" && error.details
              ? (error.details as Record<string, unknown>)
              : undefined,
        },
        { status: error.status },
      );
    }
    throw error;
  }
}

export default function LoanDetail({ loaderData }: Route.ComponentProps) {
  const {
    loan,
    canDecide,
    userId,
    customerHasId,
    customerHasIdDocument,
    eligibility,
    overdue,
    repayments,
  } = loaderData;

  const pending = isPending(loan);
  const open = isOpen(loan);

  return (
    <Page className="max-w-none">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-2xl font-bold tracking-tight">Payment history</h2>
          <StatusPill
            label={LOAN_STATUS_LABELS[loan.status]}
            tone={LOAN_STATUS_TONE[loan.status]}
          />
          {loan.status === "rejected" && loan.rejectionReason && (
            <span className="text-sm text-muted-foreground">{loan.rejectionReason}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {open && (
            <Button asChild>
              <Link to={`/loans/${loan.id}/repay`} prefetch="intent" preventScrollReset>
                <BanknoteArrowDownIcon />
                Record repayment
              </Link>
            </Button>
          )}
          <LoanMenu
            loanId={loan.id}
            customerId={loan.customerId}
            open={open}
            disbursed={Boolean(loan.disbursedAt)}
            /* Handing cash back is the office's decision, and only once the
               loan is repaid. */
            collateralReturnable={canDecide && canReturnCollateral(loan)}
            /* Taking a loan out of the book is the office's, whatever state
               it is in — so the counter is shown the entry greyed, not live. */
            trashable={canDecide && canTrash(loan)}
          />
        </div>
      </header>

      <div className="space-y-4">
        <Kpis loan={loan} overdue={overdue} repayments={repayments.length} />

        <Charges loan={loan} />

        {pending && canDecide && (
          <Decision
            eligibility={eligibility}
            customerHasId={customerHasId}
            customerHasIdDocument={customerHasIdDocument}
          />
        )}

        <Repayments loan={loan} rows={repayments} canDecide={canDecide} userId={userId} />
      </div>

      {/* The repayment drawers render here, over the loan. */}
      <Outlet />
    </Page>
  );
}

/* -------------------------------------------------------------------- kpis --- */

/** The four figures of a loan, in the tiles the loans page totals wear. */
function Kpis({
  loan,
  overdue,
  repayments,
}: {
  loan: Route.ComponentProps["loaderData"]["loan"];
  overdue: number | null;
  repayments: number;
}) {
  const late = overdue !== null && isOpen(loan);
  const remainingNote =
    loan.status === "pending"
      ? "Waiting on approval"
      : loan.status === "rejected"
        ? "Not disbursed"
        : loan.status === "repaid"
          ? loan.closedAt
            ? `Settled ${formatAccraDate(loan.closedAt)}`
            : "Settled"
          : late
            ? `${formatCount(overdue)} ${overdue === 1 ? "day" : "days"} past due`
            : loan.dueDate
              ? `Due ${formatAccraDate(loan.dueDate)}`
              : "No due date";

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat
        label="Amount borrowed"
        value={formatPesewas(loan.principal)}
        note={
          loan.disbursedAt
            ? `${loan.durationMonths} months from ${formatAccraDate(loan.disbursedAt)}`
            : `${loan.durationMonths} months`
        }
        icon={BanknoteIcon}
        tone="neutral"
      />
      <Stat
        label="Total due"
        value={formatPesewas(loan.totalDue)}
        note={`${formatPesewas(loan.interestAmount)} interest at ${loan.ratePercent}%`}
        icon={CoinsIcon}
        tone="revenue"
      />
      <Stat
        label="Paid"
        value={formatPesewas(loan.totalRepaid)}
        note={`${formatCount(repayments)} ${repayments === 1 ? "repayment" : "repayments"}`}
        icon={HandCoinsIcon}
        tone="in"
      />
      <Stat
        label="Remaining"
        value={formatPesewas(loan.remaining)}
        note={remainingNote}
        icon={late ? AlertTriangleIcon : WalletIcon}
        tone={late ? "danger" : "neutral"}
      />
    </div>
  );
}

/**
 * The processing fee and the cash collateral (client decision, 6 Oct 2026),
 * kept apart from the loan's own figures because neither is part of what it
 * owes. Drawn only when the loan carries either.
 */
function Charges({ loan }: { loan: Route.ComponentProps["loaderData"]["loan"] }) {
  if (!loan.processingFee && !loan.collateralAmount) return null;
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2 rounded-2xl bg-card px-4 py-3 text-sm">
      {loan.processingFee ? (
        <div className="flex items-baseline gap-2">
          <dt className="text-muted-foreground">Processing fee</dt>
          <dd className="tabular font-medium">{formatPesewas(loan.processingFee)}</dd>
        </div>
      ) : null}
      {loan.collateralAmount ? (
        <div className="flex items-baseline gap-2">
          <dt className="text-muted-foreground">Cash collateral</dt>
          <dd className="tabular font-medium">{formatPesewas(loan.collateralAmount)}</dd>
          <dd className="text-xs text-muted-foreground">
            {loan.collateralReturnedAt
              ? `handed back ${formatAccraDate(loan.collateralReturnedAt)}`
              : "held"}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/** The dashboard's KPI tile, as the loans page draws it. */
function Stat({
  label,
  value,
  note,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof BanknoteIcon;
  tone: "in" | "danger" | "revenue" | "neutral";
}) {
  return (
    <div className="relative rounded-2xl bg-card p-4">
      <span
        aria-hidden
        className={cn(
          "absolute top-3.5 right-3.5 rounded-lg p-2",
          tone === "in" && "bg-cash-in-subtle",
          tone === "danger" && "bg-danger-subtle",
          tone === "revenue" && "bg-revenue-subtle",
          tone === "neutral" && "bg-internal-subtle",
        )}
      >
        <Icon
          className={cn(
            "size-4",
            tone === "in" && "text-cash-in",
            tone === "danger" && "text-danger",
            tone === "revenue" && "text-revenue-foreground",
            tone === "neutral" && "text-internal",
          )}
        />
      </span>
      <p
        className={cn(
          "tabular pr-10 text-[22px] font-bold tracking-tight",
          tone === "in" && "text-cash-in",
          tone === "danger" && "text-danger",
          tone === "revenue" && "text-revenue-foreground",
          tone === "neutral" && "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs font-medium">{label}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- decision --- */

/**
 * A pending application waits on a person; this row is the whole mechanism.
 * The conditions the API refuses on are listed as blockers, not advice,
 * because it will refuse either way.
 */
function Decision({
  eligibility,
  customerHasId,
  customerHasIdDocument,
}: {
  eligibility: LoanEligibility | null;
  customerHasId: boolean;
  customerHasIdDocument: boolean;
}) {
  const fetcher = useFetcher<ActionResult>();
  const [reason, setReason] = useState("");
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) toast.success(fetcher.data.message);
    else toast.error(fetcher.data.message);
  }, [fetcher.data]);

  const hasId = eligibility?.customer.hasId ?? customerHasId;
  const hasScans = eligibility?.customer.hasIdDocument ?? customerHasIdDocument;
  const openLoan = eligibility?.openLoan ?? null;
  const blockers = [
    !hasId && "No ID on the customer's profile",
    !hasScans && "ID photos not uploaded",
  ].filter((b): b is string => Boolean(b));
  const blocked = blockers.length > 0 || openLoan != null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-card px-4 py-3">
      <ApproveButton
        disabled={busy || blocked}
        onConfirm={() => fetcher.submit({ intent: "approve" }, { method: "post" })}
      />
      <RejectButton
        disabled={busy}
        reason={reason}
        setReason={setReason}
        onConfirm={() => fetcher.submit({ intent: "reject", reason }, { method: "post" })}
      />
      {blocked && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-danger">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
          {openLoan && (
            <li>
              <Link to={`/loans/${openLoan.id}`} className="underline underline-offset-4">
                A loan is already open
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function ApproveButton({
  disabled,
  onConfirm,
}: {
  disabled: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button disabled={disabled} onClick={() => setOpen(true)}>
        <CheckIcon />
        Approve
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve this loan?</AlertDialogTitle>
            <AlertDialogDescription>
              The rate locks, the schedule is generated and the customer is sent
              an SMS. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>Approve</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RejectButton({
  disabled,
  reason,
  setReason,
  onConfirm,
}: {
  disabled: boolean;
  reason: string;
  setReason: (next: string) => void;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <XIcon />
        Reject
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this application?</AlertDialogTitle>
            <AlertDialogDescription>
              No money moves. The reason stays on the record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason" className="text-sm font-medium">
              Reason
            </Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="Not enough saving history."
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!reason.trim()}
              onClick={onConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* -------------------------------------------------------------- repayments --- */

/**
 * Every payment against the loan, newest first as the API sends them. Each row
 * carries a ⋯ menu with its receipt — a resource route answering with bytes,
 * so a plain anchor rather than a `Link` — and the correction: the office
 * corrects the newest cash repayment outright, the counter asks.
 */
function Repayments({
  loan,
  rows,
  canDecide,
  userId,
}: {
  loan: Route.ComponentProps["loaderData"]["loan"];
  rows: {
    id: string;
    amount: number;
    /** What was still owed once this repayment had landed. */
    balance: number;
    source: string;
    at: string;
    recordedBy: string;
    locked: string | null;
    pending: PendingCorrection | null;
  }[];
  canDecide: boolean;
  userId: string;
}) {
  const fetcher = useFetcher<CorrectionOutcome>();
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) toast.success(fetcher.data.message);
    else toast.error(fetcher.data.message);
  }, [fetcher.state, fetcher.data]);

  // A repayment can be corrected while the loan is open or was settled by
  // it; anything else on the loan is final.
  const closed =
    loan.status === "active" || loan.status === "arrears" || loan.status === "repaid"
      ? null
      : `This loan is ${loan.status}, so nothing on it can change.`;
  const newestId = rows[0]?.id ?? null;
  void userId;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing has been paid against this loan yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <Th>When</Th>
              <Th>Source</Th>
              <Th className="hidden sm:table-cell">Recorded by</Th>
              <Th className="text-right">Balance before</Th>
              <Th className="text-right">Amount</Th>
              <Th className="text-right">Balance after</Th>
              <Th className="text-right">Actions</Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="px-4 py-3 whitespace-nowrap">
                  {row.at}
                </TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">
                  {row.source}
                </TableCell>
                <TableCell className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                  {row.recordedBy}
                </TableCell>
                <TableCell className="tabular px-4 py-3 text-right whitespace-nowrap text-muted-foreground">
                  {formatPesewas(row.balance + row.amount)}
                </TableCell>
                <TableCell className="tabular px-4 py-3 text-right font-medium whitespace-nowrap text-cash-in">
                  +{formatAmount(row.amount)}
                  {/* A correction somebody asked for and the office has not
                      yet answered. The figure above is still what stands. */}
                  {row.pending && (
                    <p className="text-xs font-normal text-warning">
                      {formatPesewas(row.pending.amount)} waiting
                    </p>
                  )}
                </TableCell>
                <TableCell
                  className={cn(
                    "tabular px-4 py-3 text-right whitespace-nowrap",
                    row.balance === 0 ? "text-muted-foreground" : "font-medium",
                  )}
                >
                  {formatPesewas(row.balance)}
                </TableCell>
                <TableCell className="px-4 py-3 text-right">
                  <TxnRowMenu
                    txn={{ id: row.id, amount: row.amount }}
                    // What the loan owed before this repayment landed is what
                    // a corrected amount is checked against.
                    context={
                      row.locked
                        ? null
                        : {
                            kind: "loan-repayment",
                            remainingBefore: loan.remaining + row.amount,
                          }
                    }
                    targetId={loan.id}
                    pending={row.pending}
                    blocked={whyNotCorrectable({
                      pending: row.pending,
                      locked: row.locked,
                      closed,
                      newest: row.id === newestId,
                      noun: "repayment",
                    })}
                    canDecide={canDecide}
                    fetcher={fetcher}
                    srLabel="Actions for this repayment"
                    before={
                      <>
                        <DropdownMenuItem asChild>
                          <a
                            href={`/loans/${loan.id}/repayments/${row.id}/receipt`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <PrinterIcon />
                            Print receipt
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- menus --- */

function LoanMenu({
  loanId,
  customerId,
  open,
  disbursed,
  collateralReturnable,
  trashable,
}: {
  loanId: string;
  customerId: string;
  open: boolean;
  /** Whether the money has left the drawer — the receipt exists only after. */
  disbursed: boolean;
  /** Cash collateral is held and the loan is repaid — it may go back. */
  collateralReturnable: boolean;
  trashable: boolean;
}) {
  const fetcher = useFetcher<ActionResult>();
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (fetcher.data && !fetcher.data.ok) toast.error(fetcher.data.message);
  }, [fetcher.data]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon">
            <MoreHorizontalIcon />
            <span className="sr-only">More actions for this loan</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem asChild disabled={!open}>
            <Link to={`/loans/${loanId}/repay`} prefetch="intent">
              <BanknoteArrowDownIcon />
              Record repayment
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild disabled={!open}>
            <Link to={`/loans/${loanId}/repay/susu`} prefetch="intent">
              <CoinsIcon />
              Repay from susu balance
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild disabled={!open}>
            <Link to={`/loans/${loanId}/repay/loan-savings`} prefetch="intent">
              <PiggyBankIcon />
              Pay from loan savings
            </Link>
          </DropdownMenuItem>
          {/* The third way money reaches a loan: a prompt on the customer's own
              handset. It credits when Paystack confirms, not when it is sent. */}
          <DropdownMenuItem asChild disabled={!open}>
            <Link to={`/loans/${loanId}/charge`} prefetch="intent">
              <SmartphoneIcon />
              Repay by mobile money
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Proof the customer received the money. A resource route answering
              with bytes — a plain anchor, so the router does not try to
              navigate to it. Disabled rather than absent before the payout:
              the API would answer NOT_DISBURSED, and the menu should say so. */}
          <DropdownMenuItem asChild disabled={!disbursed}>
            <a
              href={`/loans/${loanId}/disbursement/receipt`}
              target="_blank"
              rel="noreferrer"
            >
              <PrinterIcon />
              Print disbursement receipt
            </a>
          </DropdownMenuItem>
          {collateralReturnable && (
            <DropdownMenuItem asChild>
              <Link to={`/loans/${loanId}/collateral/return`} prefetch="intent">
                <HandCoinsIcon />
                Return collateral
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to={`/customers/${customerId}`}>
              <UserIcon />
              Customer
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!trashable}
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              setConfirmTrash(true);
            }}
          >
            <Trash2Icon />
            Move to trash
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmTrash} onOpenChange={setConfirmTrash}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Move this application to the trash?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Only a pending or rejected application can be trashed. It can be
              restored from Trash.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="trash-reason" className="text-sm font-medium">
              Reason <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="trash-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder="Duplicate application."
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                fetcher.submit({ intent: "trash", reason }, { method: "post" })
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

