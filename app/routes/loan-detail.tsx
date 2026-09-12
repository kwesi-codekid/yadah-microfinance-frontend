import {
  BanknoteArrowDownIcon,
  CheckIcon,
  CoinsIcon,
  FileImageIcon,
  IdCardIcon,
  LockIcon,
  MoreHorizontalIcon,
  PrinterIcon,
  SmartphoneIcon,
  SnowflakeIcon,
  Trash2Icon,
  TrendingUpIcon,
  TriangleAlertIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { data, Link, Outlet, useFetcher } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
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
import { Figure, StatusPill, Th } from "~/components/listing";
import { BackLink, Page } from "~/components/page";
import { SignatureCard } from "~/components/signature-card";
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
import { ID_TYPE_LABELS, hasIdDocument } from "~/lib/customers";
import {
  accraDay,
  formatAccraDate,
  formatAccraDateTime,
  formatAmount,
  formatCount,
  formatPesewas,
} from "~/lib/format";
import {
  INSTALLMENT_LABELS,
  INSTALLMENT_TONE,
  LOAN_STATUS_BLURBS,
  LOAN_STATUS_LABELS,
  LOAN_STATUS_TONE,
  SOURCE_LABELS,
  TIER_LABELS,
  canTrash,
  daysOverdue,
  isOpen,
  isPending,
  rateFor,
  repaymentProgress,
  withDefaults,
  type LoanEligibility,
  type LoanGuarantor,
} from "~/lib/loans";
import { requireCounter, requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/loan-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.customerName ?? "Loan";
  return [{ title: `${name}'s loan · Yadah Dynamic Enterprise` }];
}

// The counter reads a loan to take a repayment against it. Approving and
// rejecting live in the action below, which stays office.
export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireCounter(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const detail = await getLoan(token, params.id);
      const [customer, config, staff, eligibility] = await Promise.all([
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
      ]);
      return { detail, customer, config, staff, eligibility };
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

  return data(
    {
      loan,
      /** Approving and rejecting are the office's, not the counter's. */
      canDecide: isOffice(viewer),
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
        source: SOURCE_LABELS[r.source] ?? r.source,
        at: r.createdAt ? formatAccraDateTime(r.createdAt) : "—",
        recordedBy: r.recordedById
          ? (names.get(r.recordedById) ?? "Staff")
          : "System",
      })),
    },
    { headers },
  );
}

/** Opening a repayment drawer does not re-read the loan underneath it. */
export const shouldRevalidate = drawerParentShouldRevalidate;

interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Approve, reject and trash. Approving is the one place in this module where
 * money starts moving, so it locks the rate and builds the schedule and then
 * the loader re-reads the loan — the page after an approval is a different page
 * from the page before it.
 */
export async function action({ request, params }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const reason = String(form.get("reason") ?? "").trim();

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
        { ok: false, message: error.message },
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
    customerName,
    customerHasId,
    customerHasIdDocument,
    eligibility,
    standardRate,
    overdue,
    schedule,
    repayments,
  } = loaderData;

  const pending = isPending(loan);
  const open = isOpen(loan);
  const progress = repaymentProgress(loan);

  return (
    <Page className="max-w-none">
      <BackLink to="/loans" className="mb-4">
        All loans
      </BackLink>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-heading text-2xl font-bold tracking-tight">
              {customerName}
            </h2>
            <StatusPill
              label={LOAN_STATUS_LABELS[loan.status]}
              blurb={LOAN_STATUS_BLURBS[loan.status]}
              tone={LOAN_STATUS_TONE[loan.status]}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {TIER_LABELS[loan.tier]} tier · {loan.durationMonths} months ·{" "}
            {formatPesewas(loan.principal)} principal
          </p>
        </div>

        <div className="flex items-center gap-2">
          {open && (
            <Button asChild>
              <Link
                to={`/loans/${loan.id}/repay`}
                prefetch="intent"
                preventScrollReset
              >
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
            /* Taking a loan out of the book is the office's, whatever state
               it is in — so the counter is shown the entry greyed, not live. */
            trashable={canDecide && canTrash(loan)}
          />
        </div>
      </header>

      {loan.status === "rejected" && loan.rejectionReason && (
        <Note tone="muted" icon={<XIcon className="size-4" />}>
          <span className="font-medium">Rejected.</span> {loan.rejectionReason}
        </Note>
      )}

      {overdue !== null && open && (
        <Note tone="danger" icon={<TriangleAlertIcon className="size-4" />}>
          <span className="font-medium">
            {formatCount(overdue)} {overdue === 1 ? "day" : "days"} past due.
          </span>
        </Note>
      )}

      {pending && !canDecide && (
        <Note tone="muted" icon={<LockIcon className="size-4" />}>
          Waiting on a manager's approval.
        </Note>
      )}

      {/* Who stands behind it. Above the decision because it is part of the
          decision, and kept on the page afterwards because it is who the branch
          turns to if the repayments stop. */}
      {loan.guarantor && (
        <GuarantorCard
          guarantor={loan.guarantor}
          customerId={loan.guarantorId}
        />
      )}

      {pending && canDecide ? (
        <DecisionPanel
          eligibility={eligibility}
          customerHasId={customerHasId}
          customerHasIdDocument={customerHasIdDocument}
          principal={loan.principal}
          interest={loan.interestAmount}
          totalDue={loan.totalDue}
          ratePercent={loan.ratePercent}
        />
      ) : (
        <>
          <section className="mb-6 rounded-xl border border-border bg-card p-4">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Figure label="Principal" value={formatPesewas(loan.principal)} />
              <Figure
                label="Interest"
                value={formatPesewas(loan.interestAmount)}
                hint={`${loan.ratePercent}% flat`}
              />
              <Figure
                label="Repaid"
                value={formatPesewas(loan.totalRepaid)}
                tone="success"
              />
              <Figure
                label="Remaining"
                value={formatPesewas(loan.remaining)}
                tone={loan.remaining > 0 ? "warning" : "muted"}
                hint={`of ${formatPesewas(loan.totalDue)} repayable`}
              />
            </dl>

            <div className="mt-4 space-y-2">
              <div
                className="flex h-2 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${Math.round(progress * 100)}% of the loan repaid`}
              >
                <div
                  className={cn(
                    "h-full transition-[width]",
                    loan.status === "arrears" ? "bg-warning" : "bg-primary",
                  )}
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {Math.round(progress * 100)}% repaid
                {loan.dueDate ? ` · due ${formatAccraDate(loan.dueDate)}` : ""}
                {loan.repaidOnTime
                  ? " · repaid on time — big tier unlocked"
                  : ""}
              </p>
            </div>
          </section>

          {loan.signatureUrl && <SignatureCard url={loan.signatureUrl} />}

          <RateLadder
            current={loan.ratePercent}
            standard={standardRate}
            escalated={Boolean(loan.escalatedAt)}
            escalatedAt={loan.escalatedAt}
            frozen={loan.frozen}
          />

          <Schedule rows={schedule} />
          <Repayments loanId={loan.id} rows={repayments} />
        </>
      )}

      {/* The repayment drawers render here, over the loan. */}
      <Outlet />
    </Page>
  );
}

/* --------------------------------------------------------------- guarantor --- */

/**
 * Who stands behind the loan.
 *
 * Read off the snapshot taken when the application was recorded, not off the
 * guarantor's profile as it is today: this has to say who was accepted on the
 * day. The link goes to their record all the same, since the reason to look
 * them up is usually to reach them.
 */
function GuarantorCard({
  guarantor,
  customerId,
}: {
  guarantor: LoanGuarantor;
  /** Absent on a snapshot written before the id was stored alongside it. */
  customerId?: string;
}) {
  const id =
    guarantor.idType && guarantor.idNumber
      ? `${ID_TYPE_LABELS[guarantor.idType]} ${guarantor.idNumber}`
      : null;

  return (
    <section className="mb-6 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="eyebrow text-muted-foreground">Guarantor</span>
        <span className="font-medium">
          {customerId ? (
            <Link
              to={`/customers/${customerId}`}
              className="underline-offset-4 hover:underline"
            >
              {guarantor.fullName}
            </Link>
          ) : (
            guarantor.fullName
          )}
        </span>
        <span className="tabular text-sm text-muted-foreground">
          {guarantor.phone}
        </span>
        {id && <span className="text-sm text-muted-foreground">{id}</span>}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- rate ladder --- */

/**
 * The one figure on a loan that moves.
 *
 * Interest is flat and computed on the original principal, so an escalated loan
 * shows an interest amount that cannot be reconciled against the rate the
 * customer signed for — unless both rates are on the page. When the ladder is
 * spent, `frozen` says the rate can rise no further, which is the only good
 * news an overdue loan ever carries and belongs beside it.
 */
function RateLadder({
  current,
  standard,
  escalated,
  escalatedAt,
  frozen,
}: {
  current: number;
  standard: number;
  escalated: boolean;
  escalatedAt?: string;
  frozen: boolean;
}) {
  if (!escalated) {
    return (
      <section className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <span className="eyebrow text-muted-foreground">Rate</span>
        <span className="tabular font-semibold">{current}% flat</span>
        <span className="text-muted-foreground">
          Locked at approval. It rises only if the loan runs past due.
        </span>
      </section>
    );
  }

  return (
    <section className="mb-6 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="eyebrow text-muted-foreground">Rate</span>
        <span className="tabular text-muted-foreground line-through">
          {standard}%
        </span>
        <TrendingUpIcon aria-hidden className="size-4 text-warning" />
        <span className="tabular font-semibold text-warning">
          {current}% flat
        </span>
        {frozen && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium">
            <SnowflakeIcon className="size-3" />
            Frozen
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Escalated{" "}
        {escalatedAt ? `on ${formatAccraDate(escalatedAt)}` : "while overdue"}.
        Interest is recomputed on the original principal each time the rate
        moves up
        {frozen
          ? ", and the ladder is now spent — it can rise no further."
          : ", and it will move again if the loan stays late."}
        {" The struck-through figure is what this duration carries today."}
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------- decision --- */

/**
 * A pending application is a queue item, not a record — so the page is the
 * decision, and the figures and the history sit inside it rather than around
 * it. There is no automatic approval anywhere in this API; this panel is the
 * whole mechanism.
 */
function DecisionPanel({
  eligibility,
  customerHasId,
  customerHasIdDocument,
  principal,
  interest,
  totalDue,
  ratePercent,
}: {
  eligibility: LoanEligibility | null;
  customerHasId: boolean;
  customerHasIdDocument: boolean;
  principal: number;
  interest: number;
  totalDue: number;
  ratePercent: number;
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
  const blocked = !hasId || !hasScans || openLoan != null;

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h3 className="font-heading font-bold tracking-tight">
          Waiting on a decision
        </h3>
      </header>

      <div className="space-y-5 p-4">
        <dl className="grid gap-3 sm:grid-cols-3">
          <Figure label="Principal" value={formatPesewas(principal)} />
          <Figure
            label="Interest"
            value={formatPesewas(interest)}
            hint={`${ratePercent}% flat`}
          />
          <Figure label="Total repayable" value={formatPesewas(totalDue)} />
        </dl>

        {eligibility ? (
          <div className="space-y-3">
            <h4 className="eyebrow text-muted-foreground">Their record</h4>
            <dl className="grid gap-3 sm:grid-cols-3">
              <Figure
                label="Saving for"
                value={`${eligibility.monthsOfHistory} month${eligibility.monthsOfHistory === 1 ? "" : "s"}`}
              />
              <Figure
                label="Susu paid in"
                value={formatPesewas(eligibility.susu.totalDeposited)}
                hint={`${eligibility.susu.activeAccounts} active of ${eligibility.susu.accounts}`}
              />
              <Figure
                label="Savings balance"
                value={formatPesewas(eligibility.savings.totalBalance)}
                hint={`${eligibility.savings.accounts} account${eligibility.savings.accounts === 1 ? "" : "s"}`}
              />
            </dl>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Their history could not be read.
          </p>
        )}

        {/* The conditions that make approval impossible. Shown as blockers
            rather than as advice, because the API will refuse either way. */}
        {blocked && (
          <ul className="space-y-1.5 text-sm">
            {!hasId && (
              <li className="flex items-start gap-2 text-danger">
                <IdCardIcon className="mt-0.5 size-4 shrink-0" />
                <span>
                  No ID on the profile. Record the type and number on the
                  customer record before approving — any type will do.
                </span>
              </li>
            )}
            {!hasScans && (
              <li className="flex items-start gap-2 text-danger">
                <FileImageIcon className="mt-0.5 size-4 shrink-0" />
                <span>
                  ID document not uploaded. Add the front and back to the
                  customer record before approving.
                </span>
              </li>
            )}
            {openLoan && (
              <li className="flex items-start gap-2 text-danger">
                <LockIcon className="mt-0.5 size-4 shrink-0" />
                <span>
                  A loan is already open for this customer.{" "}
                  <Link
                    to={`/loans/${openLoan.id}`}
                    className="underline underline-offset-4"
                  >
                    Settle it first
                  </Link>
                  .
                </span>
              </li>
            )}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <ApproveButton
            disabled={busy || blocked}
            onConfirm={() =>
              fetcher.submit({ intent: "approve" }, { method: "post" })
            }
          />

          <RejectButton
            disabled={busy}
            reason={reason}
            setReason={setReason}
            onConfirm={() =>
              fetcher.submit({ intent: "reject", reason }, { method: "post" })
            }
          />
        </div>
      </div>
    </section>
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

/* ---------------------------------------------------------------- schedule --- */

interface ScheduleRow {
  installmentNumber: number;
  due: string;
  amountDue: number;
  amountPaid: number;
  status: string;
  overdue: number | null;
}

/**
 * The instalments, generated at approval. Each row carries how much of itself
 * has been paid as a fill behind the figure — repayments are allocated
 * oldest-first, so what the schedule shows is a front that moves down the list
 * rather than a set of independent bills.
 */
function Schedule({ rows }: { rows: ScheduleRow[] }) {
  if (rows.length === 0) return null;

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h3 className="font-heading font-bold tracking-tight">Schedule</h3>
      </header>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <Th className="w-12">#</Th>
            <Th>Due</Th>
            <Th className="text-right">Amount</Th>
            <Th className="text-right">Paid</Th>
            <Th>Status</Th>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const tone = INSTALLMENT_TONE[row.status] ?? "muted";
            const filled =
              row.amountDue > 0
                ? Math.min(1, Math.max(0, row.amountPaid / row.amountDue))
                : 0;
            return (
              <TableRow key={row.installmentNumber}>
                <TableCell className="tabular px-4 py-3 text-sm text-muted-foreground">
                  {row.installmentNumber}
                </TableCell>
                <TableCell className="px-4 py-3 whitespace-nowrap">
                  {row.due}
                  {row.overdue !== null && row.status !== "paid" && (
                    <p className="tabular text-xs text-danger">
                      {formatCount(row.overdue)} days late
                    </p>
                  )}
                </TableCell>
                <TableCell className="tabular px-4 py-3 text-right font-medium whitespace-nowrap">
                  {formatPesewas(row.amountDue)}
                  <span
                    className="mt-1 block h-1 overflow-hidden rounded-full bg-muted"
                    aria-hidden
                  >
                    <span
                      className={cn(
                        "block h-full",
                        tone === "success" && "bg-success",
                        tone === "warning" && "bg-warning",
                        tone === "danger" && "bg-danger",
                        tone === "muted" && "bg-muted-foreground/30",
                      )}
                      style={{ width: `${filled * 100}%` }}
                    />
                  </span>
                </TableCell>
                <TableCell className="tabular px-4 py-3 text-right whitespace-nowrap text-muted-foreground">
                  {formatAmount(row.amountPaid)}
                </TableCell>
                <TableCell className="px-4 py-3">
                  <StatusPill
                    label={INSTALLMENT_LABELS[row.status] ?? row.status}
                    tone={tone}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

/* -------------------------------------------------------------- repayments --- */

/**
 * Every payment against the loan, newest first as the API sends them. Each row
 * carries a ⋯ menu with its receipt — a resource route answering with bytes,
 * so a plain anchor rather than a `Link`.
 */
function Repayments({
  loanId,
  rows,
}: {
  loanId: string;
  rows: {
    id: string;
    amount: number;
    source: string;
    at: string;
    recordedBy: string;
  }[];
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h3 className="font-heading font-bold tracking-tight">Repayments</h3>
      </header>
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
                <TableCell className="px-4 py-3 text-muted-foreground">
                  {row.source}
                </TableCell>
                <TableCell className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                  {row.recordedBy}
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
                          href={`/loans/${loanId}/repayments/${row.id}/receipt`}
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

/* ------------------------------------------------------------------- menus --- */

function LoanMenu({
  loanId,
  customerId,
  open,
  disbursed,
  trashable,
}: {
  loanId: string;
  customerId: string;
  open: boolean;
  /** Whether the money has left the drawer — the receipt exists only after. */
  disbursed: boolean;
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
              Repay by closing a susu account
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

/* -------------------------------------------------------------------- note --- */

function Note({
  tone,
  icon,
  children,
}: {
  tone: "danger" | "warning" | "muted";
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role="note"
      className={cn(
        "mb-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
        tone === "danger" && "border-danger/40 bg-danger/10",
        tone === "warning" && "border-warning/40 bg-warning/10",
        tone === "muted" && "border-border bg-muted/40",
      )}
    >
      <span
        className={cn(
          "mt-0.5 shrink-0",
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span>{children}</span>
    </div>
  );
}
