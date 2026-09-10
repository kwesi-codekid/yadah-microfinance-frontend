import {
  BanknoteArrowDownIcon,
  BanknoteArrowUpIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DoorClosedIcon,
  DownloadIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  SmartphoneIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  data,
  Link,
  Outlet,
  useFetcher,
  useSearchParams,
  useSubmit,
} from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { getCustomer } from "~/api/customers";
import { ApiError } from "~/api/error";
import {
  closeAccount,
  getAccount,
  listTrashedTxns,
  listTxns,
  restoreTxn,
  trashAccount,
  trashTxn,
} from "~/api/savings";
import { listUsers } from "~/api/users";
import { BackLink, Page } from "~/components/page";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
import {
  AccountTypeTag,
  PagerButton,
  SavingsStatusPill,
  Th,
  TxnTypeTag,
} from "~/components/savings-bits";
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
import { DateField } from "~/components/ui/date-field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";
import { isCounter, isOffice } from "~/lib/auth";
import {
  accraDay,
  formatAccraDate,
  formatAccraDateTime,
  formatAmount,
  formatCount,
  formatDayRange,
  formatPesewas,
} from "~/lib/format";
import {
  CHANNEL_LABELS,
  MIN_BALANCE,
  WITHDRAWAL_FEE,
  closureFlagged,
  closurePayout,
  withdrawnToday,
  type SavingsAccount,
  type SavingsTxn,
  type SavingsTxnType,
} from "~/lib/savings";
import { requireCounter, requireUser, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/savings-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  const n = loaderData?.account.accountNumber ?? "Account";
  return [{ title: `Savings #${n} · Yadah Dynamic Enterprise` }];
}

/** A statement has no ceiling, so it pages through the API rather than at once. */
const PAGE_SIZE = 20;

/** Enough unfiltered rows to settle "is this the newest" and today's slot. */
const RECENT = 5;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const office = isOffice(user);
  const showTrashed = url.searchParams.get("trashed") === "1" && office;
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : "";
  };
  const range = { from: day("from"), to: day("to") };

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const { account } = await getAccount(token, params.id);
      const [customer, txns, recent, trashed, staff] = await Promise.all([
        getCustomer(token, account.customerId)
          .then((r) => r.customer)
          .catch(() => null),
        listTxns(token, params.id, {
          page,
          limit: PAGE_SIZE,
          from: range.from || undefined,
          to: range.to || undefined,
        }),
        // Unfiltered and tiny. Which row is *the* newest decides what can be
        // corrected, and a date filter or a second page would otherwise make
        // the answer depend on what happens to be on screen.
        listTxns(token, params.id, { limit: RECENT }),
        // Only fetched when it is being looked at — the office pane is a
        // deliberate detour, not something every page view should pay for.
        showTrashed
          ? listTrashedTxns(token, params.id, { limit: PAGE_SIZE })
          : Promise.resolve(null),
        // A transaction names whoever recorded it by id and nothing else.
        // `/users` is the only place a name lives, and only the office may read
        // it — a collector sees their own name and an id for anyone else.
        office
          ? listUsers(token, { limit: 100 }).catch(() => null)
          : Promise.resolve(null),
      ]);
      return { account, customer, txns, recent, trashed, staff };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  const names = new Map<string, string>(
    result.staff?.items.map((u) => [u.id, u.name]) ?? [],
  );
  names.set(user.id, user.name);
  const nameOf = (id: string) => names.get(id) ?? `Staff #${shortId(id)}`;

  return data(
    {
      /** Correcting a transaction, and the trashed view. Office only. */
      canManage: office,
      /** Closing, paying out and withdrawing — counter work. */
      canServe: isCounter(user),
      account: {
        ...result.account,
        // The detail endpoint omits it; the customer record is the only source.
        customerName: result.customer?.fullName ?? result.account.customerName,
      },
      showTrashed,
      page,
      range,
      /** Whether today's one withdrawal has already gone. */
      usedTodaysWithdrawal: withdrawnToday(result.recent.items, accraDay()),
      /** The newest live transaction on the account — the only correctable one. */
      newestId: result.recent.items[0]?.id ?? null,
      /** Nothing has ever moved through it, so it can still be trashed. */
      neverUsed: result.recent.total === 0,
      txns: {
        total: result.txns.total,
        items: result.txns.items.map((t) => ({
          ...toRow(t),
          recordedBy: nameOf(t.recordedById),
        })),
      },
      trashed:
        result.trashed?.items.map((t) => ({
          ...toRow(t),
          recordedBy: nameOf(t.recordedById),
          deletedAt: formatAccraDate(t.deletedAt),
          reason: t.deleteReason ?? null,
        })) ?? null,
    },
    { headers },
  );
}

/** Opening the deposit or withdrawal drawer does not re-read the account. */
export const shouldRevalidate = drawerParentShouldRevalidate;

function shortId(id: string): string {
  return id.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase() || id.toUpperCase();
}

interface TxnRow {
  id: string;
  type: SavingsTxnType;
  amount: number;
  fee: number;
  balanceAfter: number;
  channel: string;
  /** Created by an internal transfer. The API will not let these be touched. */
  transfer: boolean;
  at: string;
  recordedBy: string;
}

function toRow(t: SavingsTxn) {
  return {
    id: t.id,
    type: t.type,
    amount: t.amount,
    fee: t.fee ?? 0,
    balanceAfter: t.balanceAfter,
    channel: CHANNEL_LABELS[t.channel] ?? t.channel,
    transfer: t.channel === "transfer",
    at: formatAccraDateTime(t.createdAt),
  };
}

interface ActionResult {
  ok: boolean;
  message: string;
  /** `EXCEEDS_AVAILABLE` and friends carry figures worth showing. */
  details?: Record<string, unknown>;
}

/**
 * Everything that changes the account or its transactions. Closing and paying
 * out are counter work; trashing an account or a transaction is the office's,
 * which the API enforces. All of it moves money or rewrites a record, so each
 * one confirms first.
 */
export async function action({ request, params }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const txnId = String(form.get("txnId") ?? "");
  const reason = trimmedReason(form.get("reason"));

  try {
    const { data: result, headers } = await withAuth(request, async (token) => {
      switch (intent) {
        case "close": {
          const { fee, payout, flagged } = await closeAccount(token, params.id);
          return {
            message: flagged
              ? `Closed, but the balance did not cover the GH₵ ${formatAmount(fee)} fee.`
              : `Closed. GH₵ ${formatAmount(payout)} paid out, GH₵ ${formatAmount(fee)} fee.`,
            flagged,
            gone: false,
          };
        }
        case "trash-account": {
          await trashAccount(token, params.id, reason);
          return { message: "Account moved to the trash.", flagged: false, gone: true };
        }
        case "trash-txn": {
          await trashTxn(token, params.id, txnId, reason);
          return {
            message: "Transaction moved to the trash.",
            flagged: false,
            gone: false,
          };
        }
        case "restore-txn": {
          await restoreTxn(token, params.id, txnId);
          return { message: "Transaction restored.", flagged: false, gone: false };
        }
        default:
          throw new Response("Unknown action.", { status: 400 });
      }
    });

    if (result.gone) {
      await redirectWithToast(
        "/savings",
        { tone: "success", message: result.message },
        headers,
      );
    }
    // A flagged closure is not a failure, but it is not a clean one either —
    // it goes back as an error tone so it is not read as money handed over.
    return data<ActionResult>(
      { ok: !result.flagged, message: result.message },
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

/** The API wants at least two characters in a reason, or nothing at all. */
function trimmedReason(value: FormDataEntryValue | null): string | undefined {
  const s = String(value ?? "").trim();
  return s.length >= 2 ? s : undefined;
}

/* -------------------------------------------------------------------- page --- */

export default function SavingsDetail({ loaderData }: Route.ComponentProps) {
  const {
    canManage,
    canServe,
    account,
    showTrashed,
    page,
    range,
    usedTodaysWithdrawal,
    newestId,
    neverUsed,
    txns,
    trashed,
  } = loaderData;
  const [searchParams] = useSearchParams();

  const fetcher = useFetcher<ActionResult>();
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      toast.success(fetcher.data.message);
    } else {
      toast.error(fetcher.data.message, { description: describe(fetcher.data.details) });
    }
  }, [fetcher.state, fetcher.data]);

  const open = account.status === "active";
  const first = txns.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, txns.total);

  // Every link off this page keeps whatever the statement is currently filtered
  // to, so paging and switching to the trash never silently drop a date range.
  const withParams = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value == null || value === "") p.delete(key);
      else p.set(key, value);
    }
    const s = p.toString();
    return `/savings/${account.id}${s ? `?${s}` : ""}`;
  };

  return (
    <Page className="max-w-none">
      {/* Back on the left, whose account this is on the right — the same header
          the susu account page uses, so the two read as one product. */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <BackLink to="/savings">All savings accounts</BackLink>

        <div className="min-w-0 text-right">
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            <h2 className="font-heading truncate text-2xl font-bold tracking-tight">
              <Link
                to={`/customers/${account.customerId}`}
                className="underline-offset-4 hover:underline"
              >
                {account.customerName ?? "Customer"}
              </Link>
            </h2>
            <AccountTypeTag type={account.accountType} />
            <SavingsStatusPill status={account.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="tabular">#{account.accountNumber}</span>
            {account.closedAt
              ? ` · Closed ${formatAccraDate(account.closedAt)}`
              : ` · Opened ${formatAccraDate(account.openedAt)}`}
          </p>
        </div>
      </header>

      <Notices account={account} usedTodaysWithdrawal={usedTodaysWithdrawal} />

      {/* The statement. */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {showTrashed ? "Trashed transactions" : "Statement"}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {!showTrashed && <StatementRange range={range} />}
            {/* No way *into* the trash from here — the row menu is where a
                transaction is thrown away, so a toolbar button beside it only
                said the same word twice. The pane is still served at
                `?trashed=1`, and this is the way back out of it. */}
            {showTrashed && (
              <Button asChild variant="ghost" size="sm">
                <Link
                  to={withParams({ trashed: null, page: null })}
                  preventScrollReset
                  replace
                >
                  Back to statement
                </Link>
              </Button>
            )}
            <ExportMenu
              accountId={account.id}
              range={range}
              total={txns.total}
            />
            <AccountActions
              account={account}
              neverUsed={neverUsed}
              canServe={canServe}
              canManage={canManage}
              fetcher={fetcher}
            />
            {open && canServe && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/savings/${account.id}/withdraw`} prefetch="intent" preventScrollReset>
                  <BanknoteArrowUpIcon />
                  Withdraw
                </Link>
              </Button>
            )}
            {/* The same errand as the button beside it, by a different channel:
                cash is counted here and credited now, mobile money is a prompt
                on the customer's handset that credits when Paystack confirms. */}
            {open && (
              <Button asChild variant="outline" size="sm">
                <Link
                  to={`/savings/${account.id}/charge`}
                  prefetch="intent"
                  preventScrollReset
                >
                  <SmartphoneIcon />
                  Mobile money
                </Link>
              </Button>
            )}
            {open && (
              <Button asChild size="sm">
                <Link to={`/savings/${account.id}/deposit`} prefetch="intent" preventScrollReset>
                  <BanknoteArrowDownIcon />
                  Record deposit
                </Link>
              </Button>
            )}
          </div>
        </div>

        {showTrashed ? (
          <TrashedTxns rows={trashed ?? []} fetcher={fetcher} />
        ) : txns.items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {range.from || range.to
              ? "Nothing moved in that date range."
              : "Nothing has moved through this account yet."}
          </p>
        ) : (
          <TxnTable
            rows={txns.items}
            newestId={newestId}
            canManage={canManage}
            account={account}
            fetcher={fetcher}
          />
        )}

        {!showTrashed && txns.total > 0 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
            <p>
              Showing <span className="tabular font-medium text-foreground">{first}</span>
              –<span className="tabular font-medium text-foreground">{last}</span> of{" "}
              <span className="tabular font-medium text-foreground">
                {formatCount(txns.total)}
              </span>
            </p>
            <div className="flex items-center gap-2">
              <PagerButton
                to={withParams({ page: page > 2 ? String(page - 1) : null })}
                disabled={page <= 1}
                label="Previous page"
              >
                <ChevronLeftIcon />
                Prev
              </PagerButton>
              <PagerButton
                to={withParams({ page: String(page + 1) })}
                disabled={last >= txns.total}
                label="Next page"
              >
                Next
                <ChevronRightIcon />
              </PagerButton>
            </div>
          </div>
        )}
      </section>

      {/* The deposit and withdrawal drawers open over all of it. */}
      <Outlet />
    </Page>
  );
}

/** The one-line consequences a clerk has to see before choosing an action. */
function Notices({
  account,
  usedTodaysWithdrawal,
}: {
  account: SavingsAccount;
  usedTodaysWithdrawal: boolean;
}) {
  if (account.status === "closed") return null;

  if (closureFlagged(account)) {
    return (
      <Note tone="warning">
        The balance is under the GH₵ {formatAmount(WITHDRAWAL_FEE)} closing fee.
        Closing this account now pays nothing out and comes back flagged.
      </Note>
    );
  }
  if (account.availableToWithdraw <= 0) {
    return (
      <Note tone="warning">
        Nothing can be withdrawn without breaking the GH₵{" "}
        {formatAmount(MIN_BALANCE)} minimum. Closing the account is the only way
        to release what is in it.
      </Note>
    );
  }
  if (usedTodaysWithdrawal) {
    return (
      <Note tone="info">
        Today's one withdrawal has already gone out. The next one can be
        tomorrow.
      </Note>
    );
  }
  return null;
}

function Note({ tone, children }: { tone: "info" | "warning"; children: ReactNode }) {
  return (
    <p
      className={cn(
        "mb-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
        tone === "warning"
          ? "border-warning/40 bg-warning/10"
          : "border-info/40 bg-info/10",
      )}
    >
      <TriangleAlertIcon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "warning" ? "text-warning" : "text-info",
        )}
      />
      <span>{children}</span>
    </p>
  );
}

/* ----------------------------------------------------------------- actions --- */

type Fetcher = ReturnType<typeof useFetcher<ActionResult>>;

/**
 * Close and trash — whichever the state allows, rendered straight into the
 * statement toolbar rather than wrapped in a row of their own, so they sit with
 * the other things you can do to this account.
 */
function AccountActions({
  account,
  neverUsed,
  canServe,
  canManage,
  fetcher,
}: {
  account: SavingsAccount;
  /** Nothing has ever moved through it, so the API will accept a trash. */
  neverUsed: boolean;
  /** Paying a customer out is the counter's, teller included. */
  canServe: boolean;
  /** Taking the account out of the book is not. */
  canManage: boolean;
  fetcher: Fetcher;
}) {
  const [confirm, setConfirm] = useState<"close" | "trash" | null>(null);
  const [reason, setReason] = useState("");

  const open = account.status === "active";
  const canClose = open && canServe;
  // The API refuses anything else: a balance, a transaction ever recorded, or
  // an account already closed.
  const canTrash = open && canManage && neverUsed && account.balance === 0;

  if (!canClose && !canTrash) return null;

  const submit = (intent: string, extra: Record<string, string> = {}) =>
    fetcher.submit({ intent, ...extra }, { method: "post" });

  return (
    <>
      {canClose && (
        <Button
          size="sm"
          variant="outline"
          className="border-primary/25 bg-success-subtle text-primary hover:bg-success-subtle hover:text-primary"
          onClick={() => setConfirm("close")}
        >
          <DoorClosedIcon />
          Close &amp; pay out
        </Button>
      )}

      {canTrash && (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => {
            setReason("");
            setConfirm("trash");
          }}
        >
          <Trash2Icon />
          Move to trash
        </Button>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "close"
                ? "Close and pay out?"
                : "Move this account to the trash?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "close" ? (
                closureFlagged(account) ? (
                  <>
                    The balance of GH₵ {formatAmount(account.balance)} does not
                    cover the GH₵ {formatAmount(WITHDRAWAL_FEE)} fee. The account
                    still closes, nothing is paid out, and it comes back flagged
                    for the office to look at.
                  </>
                ) : (
                  <>
                    The customer receives GH₵ {formatAmount(closurePayout(account))}{" "}
                    in cash. The GH₵ {formatAmount(MIN_BALANCE)} minimum is
                    released and GH₵ {formatAmount(WITHDRAWAL_FEE)} is kept as the
                    fee. The account cannot be reopened.
                  </>
                )
              ) : (
                <>
                  Only an account nothing has ever moved through can be trashed.
                  It disappears from the book and can be restored later.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {confirm === "trash" && (
            <div className="space-y-1.5">
              <Label
                htmlFor="trash-reason"
                className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                Reason (optional)
              </Label>
              <Textarea
                id="trash-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
                rows={2}
                placeholder="Opened in error…"
              />
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                confirm !== "close" && "bg-destructive text-white hover:bg-destructive/90",
              )}
              onClick={() =>
                confirm === "trash"
                  ? submit("trash-account", { reason })
                  : submit("close")
              }
            >
              {confirm === "close" ? "Close & pay out" : "Move to trash"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ------------------------------------------------------------ transactions --- */

function TxnTable({
  rows,
  newestId,
  canManage,
  account,
  fetcher,
}: {
  rows: (TxnRow & { recordedBy: string })[];
  /** The newest transaction on the account — not merely the newest on screen. */
  newestId: string | null;
  canManage: boolean;
  account: SavingsAccount;
  fetcher: Fetcher;
}) {
  const open = account.status === "active";

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <Th>Date &amp; time</Th>
          <Th>Type</Th>
          <Th className="text-right">Amount</Th>
          <Th className="hidden text-right sm:table-cell">Fee</Th>
          <Th className="text-right">Balance</Th>
          <Th className="hidden md:table-cell">Channel</Th>
          <Th className="hidden lg:table-cell">Recorded by</Th>
          {canManage && <Th className="w-12 text-right">Actions</Th>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const out = row.type !== "deposit";
          return (
            <TableRow key={row.id}>
              <TableCell className="px-4 py-3 whitespace-nowrap">{row.at}</TableCell>
              <TableCell className="px-4 py-3">
                <TxnTypeTag type={row.type} />
              </TableCell>
              {/* Signed, because a statement read down one column is the only
                  way to see that a day went the wrong way. */}
              <TableCell
                className={cn(
                  "tabular px-4 py-3 text-right font-medium whitespace-nowrap",
                  out ? "text-warning" : "text-success",
                )}
              >
                {out ? "−" : "+"}
                {formatAmount(row.amount)}
              </TableCell>
              <TableCell className="tabular hidden px-4 py-3 text-right whitespace-nowrap text-muted-foreground sm:table-cell">
                {row.fee > 0 ? formatAmount(row.fee) : "—"}
              </TableCell>
              <TableCell className="tabular px-4 py-3 text-right whitespace-nowrap">
                {formatPesewas(row.balanceAfter)}
              </TableCell>
              <TableCell className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                {row.channel}
              </TableCell>
              <TableCell className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                {row.recordedBy}
              </TableCell>
              {canManage && (
                <TableCell className="px-4 py-3 text-right">
                  <TxnActions
                    row={row}
                    fetcher={fetcher}
                    blocked={whyNotEditable(row, newestId, open)}
                  />
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * Why this transaction cannot be taken back, or null when it can. Said the way
 * the branch would say it — the clerk needs to know what to do instead, not
 * which endpoint refused.
 */
function whyNotEditable(
  row: TxnRow,
  newestId: string | null,
  open: boolean,
): string | null {
  if (row.transfer) {
    return "This came from a transfer between accounts. Correct it on the transfer, not here.";
  }
  if (row.type === "closure") {
    return "A closure is final. It cannot be taken back from here.";
  }
  if (!open) return "This account is closed, so its transactions are final.";
  if (row.id !== newestId) {
    return "Only the newest transaction can be taken back. Remove the ones after it first.";
  }
  return null;
}

function TxnActions({
  row,
  fetcher,
  blocked,
}: {
  row: TxnRow;
  fetcher: Fetcher;
  /** Why the actions are unavailable, or null when they are not. */
  blocked: string | null;
}) {
  const editable = blocked === null;
  const [trashing, setTrashing] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setTrashing(false);
  }, [fetcher.state, fetcher.data]);

  return (
    <>
      {/* Every row carries the menu, including the ones that cannot be
          changed — an actions column that is blank on all but one row reads as
          broken. The state decides whether the items are usable, not whether
          the trigger exists. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
          >
            <MoreHorizontalIcon />
            <span className="sr-only">Actions for this transaction</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {blocked && (
            <>
              <DropdownMenuLabel className="max-w-56 font-normal text-wrap text-muted-foreground">
                {blocked}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            variant="destructive"
            disabled={!editable}
            onSelect={(e) => {
              e.preventDefault();
              setReason("");
              setTrashing(true);
            }}
          >
            <Trash2Icon />
            Move to trash
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={trashing} onOpenChange={setTrashing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move this transaction to the trash?</AlertDialogTitle>
            <AlertDialogDescription>
              {row.type === "withdrawal" ? (
                <>
                  GH₵ {formatAmount(row.amount)} goes back onto the account, along
                  with the GH₵ {formatAmount(row.fee)} fee, and today's withdrawal
                  slot is freed. It can be restored while nothing newer has taken
                  its place.
                </>
              ) : (
                <>
                  GH₵ {formatAmount(row.amount)} comes back off the account. It can
                  be restored while nothing newer has taken its place.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label
              htmlFor="txn-reason"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Reason (optional)
            </Label>
            <Textarea
              id="txn-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Recorded on the wrong account…"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                fetcher.submit(
                  { intent: "trash-txn", txnId: row.id, reason },
                  { method: "post" },
                )
              }
            >
              Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TrashedTxns({
  rows,
  fetcher,
}: {
  // No running balance: a trashed transaction has been taken back out of the
  // account, so there is no position after it to state.
  rows: (Omit<TxnRow, "balanceAfter"> & {
    recordedBy: string;
    deletedAt: string;
    reason: string | null;
  })[];
  fetcher: Fetcher;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        Nothing in the trash for this account.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <Th>Type</Th>
          <Th className="hidden sm:table-cell">Reason</Th>
          <Th>Trashed</Th>
          <Th className="text-right">Amount</Th>
          <Th className="w-12 text-right">Actions</Th>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="px-4 py-3">
              <TxnTypeTag type={row.type} />
            </TableCell>
            <TableCell className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
              {row.reason ?? "—"}
            </TableCell>
            <TableCell className="px-4 py-3 text-muted-foreground">
              {row.deletedAt}
            </TableCell>
            <TableCell className="tabular px-4 py-3 text-right font-medium whitespace-nowrap">
              {formatPesewas(row.amount)}
            </TableCell>
            <TableCell className="px-4 py-3 text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <MoreHorizontalIcon />
                    <span className="sr-only">Actions for this transaction</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    disabled={fetcher.state !== "idle"}
                    onSelect={() =>
                      fetcher.submit(
                        { intent: "restore-txn", txnId: row.id },
                        { method: "post" },
                      )
                    }
                  >
                    <RotateCcwIcon />
                    Restore
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/* ---------------------------------------------------------------- toolbars --- */

/**
 * The statement's date range. Unlike a cycle, a savings history has no end, so
 * narrowing it is how anyone reads one — and the same range travels into the
 * export, so the file matches what was on screen.
 */
function StatementRange({ range }: { range: { from: string; to: string } }) {
  const submit = useSubmit();
  const [open, setOpen] = useState(false);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();
  const active = Boolean(range.from || range.to);

  const apply = (next: { from: string; to: string }) => {
    setOpen(false);
    const p = new URLSearchParams(searchParams);
    // A new range means a new first page.
    p.delete("page");
    for (const [key, value] of Object.entries(next)) {
      if (value) p.set(key, value);
      else p.delete(key);
    }
    submit(p, { replace: true, preventScrollReset: true });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(active && "border-primary/50 text-primary")}
        >
          {active ? <CalendarIcon /> : <SlidersHorizontalIcon />}
          {active ? formatDayRange(range.from, range.to) : "Any date"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div ref={fieldsRef} key={`${range.from}|${range.to}`} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              From
            </Label>
            <DateField
              name="from"
              defaultValue={range.from || undefined}
              placeholder="Any date"
              endMonth={new Date()}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              To
            </Label>
            <DateField
              name="to"
              defaultValue={range.to || undefined}
              placeholder="Any date"
              endMonth={new Date()}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!active}
            onClick={() => apply({ from: "", to: "" })}
          >
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const read = (name: string) =>
                fieldsRef.current?.querySelector<HTMLInputElement>(
                  `input[name='${name}']`,
                )?.value ?? "";
              apply({ from: read("from"), to: read("to") });
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ExportMenu({
  accountId,
  range,
  total,
}: {
  accountId: string;
  range: { from: string; to: string };
  total: number;
}) {
  const query = new URLSearchParams();
  if (range.from) query.set("from", range.from);
  if (range.to) query.set("to", range.to);
  const suffix = query.toString();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={total === 0}>
          <DownloadIcon />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal text-muted-foreground">
          {formatCount(total)} row{total === 1 ? "" : "s"} ·{" "}
          {formatDayRange(range.from, range.to).toLowerCase()}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a
            href={`/savings/${accountId}/transactions/export?format=csv${suffix ? `&${suffix}` : ""}`}
          >
            <FileTextIcon />
            CSV
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={`/savings/${accountId}/transactions/export?format=xlsx${suffix ? `&${suffix}` : ""}`}
          >
            <DownloadIcon />
            Excel (.xlsx)
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The figures an error carries, as one line under the toast. */
function describe(details?: Record<string, unknown>): string | undefined {
  if (!details) return undefined;
  const money = (k: string) =>
    typeof details[k] === "number" ? `GH₵ ${formatAmount(details[k] as number)}` : null;

  const parts = [
    money("available") && `available ${money("available")}`,
    money("balance") && `balance ${money("balance")}`,
    money("fee") && `fee ${money("fee")}`,
    money("minimumBalance") && `minimum ${money("minimumBalance")}`,
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : undefined;
}
