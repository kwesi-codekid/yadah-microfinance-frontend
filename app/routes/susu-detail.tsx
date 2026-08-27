import {
  BanknoteArrowDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  BanknoteArrowUpIcon,
  CircleSlashIcon,
  DownloadIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCcwIcon,
  SmartphoneIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { data, Link, useFetcher, useSearchParams } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { getCustomer } from "~/api/customers";
import { listUsers } from "~/api/users";
import {
  closeAccount,
  correctDeposit,
  getAccount,
  listDeposits,
  listTrashedDeposits,
  payoutAccount,
  restoreDeposit,
  terminateAccount,
  trashAccount,
  trashDeposit,
} from "~/api/susu";
import {
  CycleGrid,
  PagerButton,
  SusuStatusPill,
  Th,
} from "~/components/susu-bits";
import { BackLink, Page } from "~/components/page";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { isOffice } from "~/lib/auth";
import {
  formatAccraDate,
  formatAccraDateTime,
  formatAmount,
  formatCount,
  formatPesewas,
  parseCedis,
  toCedisInput,
} from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import { requireOffice, requireUser, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import {
  CHANNEL_LABELS,
  checkDepositAmount,
  commissionOf,
  commissionUncovered,
  payoutIfClosedNow,
  type SusuAccount,
  type SusuDeposit,
} from "~/lib/susu";
import { cn } from "~/lib/utils";
import { Outlet } from "react-router";
import type { Route } from "./+types/susu-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  const n = loaderData?.account.accountNumber ?? "Account";
  return [{ title: `Susu #${n} · Yadah Dynamic Enterprise` }];
}

/**
 * A cycle stops at 31 deposits, so the whole history fits in a single read —
 * well inside the API's ceiling of 100. Reading it whole is what makes the
 * running balance possible: page 3's balances depend on the amounts on pages 1
 * and 2, which server-side paging would never put in front of us.
 */
const ALL_DEPOSITS = 100;

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const office = isOffice(user);
  const showTrashed = url.searchParams.get("trashed") === "1" && office;

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const { account } = await getAccount(token, params.id);
      const [customer, deposits, trashed, staff] = await Promise.all([
        getCustomer(token, account.customerId)
          .then((r) => r.customer)
          .catch(() => null),
        listDeposits(token, params.id, { limit: ALL_DEPOSITS }),
        // Only fetched when it is being looked at — the office pane is a
        // deliberate detour, not something every page view should pay for.
        showTrashed
          ? listTrashedDeposits(token, params.id, { limit: ALL_DEPOSITS })
          : Promise.resolve(null),
        // A deposit names its collector by id and nothing else. `/users` is the
        // only place a name lives, and only the office may read it — a
        // collector sees their own name and an id for anyone else.
        office
          ? listUsers(token, { limit: ALL_DEPOSITS }).catch(() => null)
          : Promise.resolve(null),
      ]);
      return { account, customer, deposits, trashed, staff };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  const names = new Map<string, string>(
    result.staff?.items.map((u) => [u.id, u.name]) ?? [],
  );
  names.set(user.id, user.name);
  const nameOf = (id: string) => names.get(id) ?? `Staff #${shortId(id)}`;

  // Oldest first to accumulate, then flipped back: the balance on a row is what
  // the account held *after* it, which only reads correctly from the bottom up.
  const oldestFirst = [...result.deposits.items].reverse();
  let running = 0;
  const balances = new Map<string, number>();
  for (const d of oldestFirst) {
    running += d.amount;
    balances.set(d.id, running);
  }

  return data(
    {
      canManage: office,
      account: {
        ...result.account,
        // The detail endpoint omits it; the customer record is the only source.
        customerName: result.customer?.fullName ?? result.account.customerName,
      },
      showTrashed,
      deposits: {
        total: result.deposits.total,
        items: result.deposits.items.map((d) => ({
          ...toRow(d),
          balance: balances.get(d.id) ?? 0,
          recordedBy: nameOf(d.collectorId),
        })),
      },
      trashed:
        result.trashed?.items.map((d) => ({
          ...toRow(d),
          recordedBy: nameOf(d.collectorId),
          deletedAt: formatAccraDate(d.deletedAt),
          reason: d.deleteReason ?? null,
        })) ?? null,
    },
    { headers },
  );
}

/** Opening the deposit drawer does not re-read the account. */
export const shouldRevalidate = drawerParentShouldRevalidate;

function shortId(id: string): string {
  return id.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase() || id.toUpperCase();
}

interface DepositRow {
  id: string;
  amount: number;
  daysCovered: number;
  seqStart: number;
  seqEnd: number;
  channel: string;
  /** Part of a collect-all round across the customer's accounts. */
  batched: boolean;
  /** Created by an internal transfer. The API will not let these be edited. */
  transfer: boolean;
  at: string;
  /** Running total after this deposit. */
  balance: number;
  recordedBy: string;
}

function toRow(d: SusuDeposit) {
  return {
    id: d.id,
    amount: d.amount,
    daysCovered: d.daysCovered,
    seqStart: d.seqStart,
    seqEnd: d.seqEnd,
    channel: CHANNEL_LABELS[d.channel] ?? d.channel,
    batched: Boolean(d.collectAllBatchId),
    transfer: d.channel === "transfer",
    at: formatAccraDateTime(d.createdAt),
  };
}

interface ActionResult {
  ok: boolean;
  message: string;
  /** `COMMISSION_NOT_COVERED`, `EXCEEDS_PAYOUT` and friends carry figures. */
  details?: Record<string, unknown>;
}

/**
 * Everything that changes the account or its deposits. All office-only, and
 * all of it moves money or rewrites a record, so each one confirms first.
 */
export async function action({ request, params }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const depositId = String(form.get("depositId") ?? "");
  const reason = trimmedReason(form.get("reason"));

  try {
    const { data: result, headers } = await withAuth(request, async (token) => {
      switch (intent) {
        case "close": {
          const { commission, payout } = await closeAccount(token, params.id);
          return {
            message: `Closed. GH₵ ${formatAmount(payout)} paid out, GH₵ ${formatAmount(commission)} commission.`,
            gone: false,
          };
        }
        case "terminate": {
          const { refund } = await terminateAccount(token, params.id);
          return {
            message: `Terminated. GH₵ ${formatAmount(refund)} refunded, no commission taken.`,
            gone: false,
          };
        }
        case "payout": {
          const amount = parseCedis(String(form.get("amount") ?? ""));
          const idempotencyKey = String(form.get("idempotencyKey") ?? "");
          const res = await payoutAccount(token, params.id, {
            idempotencyKey,
            ...(amount != null && amount > 0 ? { amount } : {}),
          });
          return {
            message: res.replayed
              ? "That payout was already recorded."
              : `Paid out GH₵ ${formatAmount(res.amount)}.`,
            gone: false,
          };
        }
        case "trash-account": {
          await trashAccount(token, params.id, reason);
          return { message: "Account moved to the trash.", gone: true };
        }
        case "correct-deposit": {
          const amount = parseCedis(String(form.get("amount") ?? ""));
          if (amount == null || amount <= 0) {
            throw new Response("Enter the corrected amount.", { status: 400 });
          }
          await correctDeposit(token, params.id, depositId, amount);
          return { message: "Deposit corrected.", gone: false };
        }
        case "trash-deposit": {
          await trashDeposit(token, params.id, depositId, reason);
          return { message: "Deposit moved to the trash.", gone: false };
        }
        case "restore-deposit": {
          await restoreDeposit(token, params.id, depositId);
          return { message: "Deposit restored.", gone: false };
        }
        default:
          throw new Response("Unknown action.", { status: 400 });
      }
    });

    if (result.gone) {
      await redirectWithToast(
        "/susu",
        { tone: "success", message: result.message },
        headers,
      );
    }
    return data<ActionResult>({ ok: true, message: result.message }, { headers });
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

export default function SusuDetail({ loaderData }: Route.ComponentProps) {
  const { canManage, account, showTrashed, deposits, trashed } = loaderData;
  // `?payout=1` arrives from the listing's row button, so paying out is one
  // click from the list rather than a page and then a menu.
  const [searchParams] = useSearchParams();
  const openPayout = searchParams.get("payout") === "1";

  // Paged here rather than on the server: the whole cycle is already loaded, so
  // turning a page is instant and costs nothing.
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(deposits.items.length / pageSize));
  const current = Math.min(page, pageCount);
  const visible = deposits.items.slice(
    (current - 1) * pageSize,
    current * pageSize,
  );

  const fetcher = useFetcher<ActionResult>();
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      toast.success(fetcher.data.message);
    } else {
      toast.error(fetcher.data.message, { description: describe(fetcher.data.details) });
    }
  }, [fetcher.state, fetcher.data]);

  const last = Math.min(current * pageSize, deposits.items.length);
  const first = deposits.items.length === 0 ? 0 : (current - 1) * pageSize + 1;

  return (
    <Page className="max-w-none">
      {/* Back on the left, whose account this is on the right — the same
          header the statement page uses, so the two read as one product. */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <BackLink to="/susu">All susu accounts</BackLink>

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
            <SusuStatusPill status={account.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="tabular">#{account.accountNumber}</span>
            {account.closedAt
              ? ` · Closed ${formatAccraDate(account.closedAt)}`
              : ` · Opened ${formatAccraDate(account.openedAt)}`}
          </p>
        </div>
      </header>

      <Notices account={account} />

      {/* The cycle: which of the 31 days are paid for, not just how many. */}
      <CycleGrid
        className="mb-6"
        count={account.depositsCount}
        target={account.cycleTarget}
        saved={formatPesewas(account.totalDeposited)}
        withdrawn={
          account.withdrawnAmount > 0
            ? formatPesewas(account.withdrawnAmount)
            : undefined
        }
        held={
          account.withdrawnAmount > 0 ? formatPesewas(account.balance) : undefined
        }
      />

      {/* Deposits. */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {showTrashed ? "Trashed deposits" : "Deposits"}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {canManage && (
              <Button asChild variant="ghost" size="sm">
                <Link
                  to={showTrashed ? "?" : "?trashed=1"}
                  preventScrollReset
                  replace
                >
                  {showTrashed ? "Back to deposits" : "Trash"}
                </Link>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={deposits.total === 0}>
                  <DownloadIcon />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="font-normal text-muted-foreground">
                  {formatCount(deposits.total)} deposit
                  {deposits.total === 1 ? "" : "s"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href={`/susu/${account.id}/deposits/export?format=csv`}>
                    <FileTextIcon />
                    CSV
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`/susu/${account.id}/deposits/export?format=xlsx`}>
                    <DownloadIcon />
                    Excel (.xlsx)
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {canManage && (
              <AccountActions
                account={account}
                fetcher={fetcher}
                openPayout={openPayout}
              />
            )}
            {/* The same collection, taken from a wallet instead of a hand. It
                credits when Paystack confirms, not when the prompt is sent. */}
            {account.status === "active" && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/susu/${account.id}/charge`} prefetch="intent">
                  <SmartphoneIcon />
                  Mobile money
                </Link>
              </Button>
            )}
            {/* Part of the balance back, cycle left running — the rule the API
                changed in August 2026. Office only, and pointless to offer when
                the reserved day is all that is left. */}
            {canManage &&
              (account.status === "active" || account.status === "completed") &&
              account.availableToWithdraw > 0 && (
                <Button asChild variant="outline" size="sm">
                  <Link to={`/susu/${account.id}/withdraw`} prefetch="intent">
                    <BanknoteArrowUpIcon />
                    Withdraw
                  </Link>
                </Button>
              )}
            {account.status === "active" && (
              <Button asChild size="sm">
                <Link to={`/susu/${account.id}/deposit`} prefetch="intent">
                  <BanknoteArrowDownIcon />
                  Record deposit
                </Link>
              </Button>
            )}
          </div>
        </div>

        {showTrashed ? (
          <TrashedDeposits rows={trashed ?? []} fetcher={fetcher} />
        ) : deposits.items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing paid in yet.
          </p>
        ) : (
          <DepositTable
            rows={visible}
            newestId={deposits.items[0]?.id ?? null}
            canManage={canManage}
            account={account}
            fetcher={fetcher}
          />
        )}

        {!showTrashed && deposits.items.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-3">
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger size="sm" className="w-20" aria-label="Rows per page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 31].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p>
                Showing{" "}
                <span className="tabular font-medium text-foreground">{first}</span>–
                <span className="tabular font-medium text-foreground">{last}</span> of{" "}
                <span className="tabular font-medium text-foreground">
                  {formatCount(deposits.items.length)}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <PagerButton
                onClick={() => setPage(current - 1)}
                disabled={current <= 1}
                label="Previous page"
              >
                <ChevronLeftIcon />
                Prev
              </PagerButton>
              <PagerButton
                onClick={() => setPage(current + 1)}
                disabled={current >= pageCount}
                label="Next page"
              >
                Next
                <ChevronRightIcon />
              </PagerButton>
            </div>
          </div>
        )}
      </section>

      {/* The record-deposit drawer opens over all of it. */}
      <Outlet />
    </Page>
  );
}

/** The one-line consequences a clerk has to see before choosing an action. */
function Notices({ account }: { account: SusuAccount }) {
  if (account.status === "completed") {
    return (
      <Note tone="info">
        The cycle is complete. Close the account to pay out GH₵{" "}
        {formatAmount(Math.max(0, payoutIfClosedNow(account)))}.
      </Note>
    );
  }
  if (account.status === "pending-payout") {
    return (
      <Note tone="warning">
        GH₵ {formatAmount(account.payoutRemaining)} is still owed to the customer.
      </Note>
    );
  }
  if (account.status === "active" && commissionUncovered(account)) {
    return (
      <Note tone="warning">
        Deposits are below one day's commission, so this account cannot be
        closed — only terminated, which refunds everything.
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
 * Close · Terminate · Pay out · Trash · Customer — whichever the state allows,
 * rendered straight into the deposits toolbar rather than wrapped in a row of
 * their own, so they sit with the other things you can do to this account.
 */
function AccountActions({
  account,
  fetcher,
  openPayout = false,
}: {
  account: SusuAccount;
  fetcher: Fetcher;
  /** Arrived from the listing asking to pay this one out. */
  openPayout?: boolean;
}) {
  const [confirm, setConfirm] = useState<"close" | "terminate" | "trash" | null>(null);
  const [payout, setPayout] = useState(openPayout);
  const [reason, setReason] = useState("");

  const stopped =
    account.status === "closed" || account.status === "terminated";
  const canClose = !stopped && !commissionUncovered(account);
  const canTerminate = !stopped && commissionUncovered(account);
  const canPayout = account.status === "pending-payout" && account.payoutRemaining > 0;
  // Only a never-used account can be trashed; the API refuses the rest.
  const canTrash = account.status === "active" && account.depositsCount === 0;

  const submit = (intent: string, extra: Record<string, string> = {}) =>
    fetcher.submit({ intent, ...extra }, { method: "post" });

  return (
    <>
      {canPayout && (
        <Button
          size="sm"
          variant="outline"
          className="border-primary/25 bg-success-subtle text-primary hover:bg-success-subtle hover:text-primary"
          onClick={() => setPayout(true)}
        >
          <BanknoteArrowUpIcon />
          Pay out
        </Button>
      )}
      {/* Both greens, but not the same weight: Record deposit is the thing
          done every day, so it keeps the solid fill. Closing happens once per
          cycle and reads as the lighter of the two. */}
      {canClose && (
        <Button
          size="sm"
          variant="outline"
          className="border-primary/25 bg-success-subtle text-primary hover:bg-success-subtle hover:text-primary"
          onClick={() => setConfirm("close")}
        >
          <BanknoteArrowUpIcon />
          Close &amp; pay out
        </Button>
      )}

      {/* No ellipsis: the state already decides which of these apply, and at
          most two ever show at once, so hiding them behind a menu only costs a
          click. Destructive ones stay quiet until hovered. */}
      {canTerminate && (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setConfirm("terminate")}
        >
          <CircleSlashIcon />
          Terminate &amp; refund
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
                : confirm === "terminate"
                  ? "Terminate and refund?"
                  : "Move this account to the trash?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "close" ? (
                <>
                  The customer receives GH₵{" "}
                  {formatAmount(Math.max(0, payoutIfClosedNow(account)))} in cash.
                  GH₵ {formatAmount(commissionOf(account))} — one day — is kept as
                  commission. The disbursement appears in the ledger.
                </>
              ) : confirm === "terminate" ? (
                <>
                  Everything paid in — GH₵ {formatAmount(account.totalDeposited)} —
                  is refunded and no commission is taken. Use this only when the
                  deposits cannot cover one day.
                </>
              ) : (
                <>
                  Only an account with no deposits can be trashed. It disappears
                  from the book and can be restored later.
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
                  : submit(confirm === "close" ? "close" : "terminate")
              }
            >
              {confirm === "close"
                ? "Close & pay out"
                : confirm === "terminate"
                  ? "Terminate"
                  : "Move to trash"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PayoutDialog
        open={payout}
        onOpenChange={setPayout}
        account={account}
        fetcher={fetcher}
      />
    </>
  );
}

/**
 * Handing over what is still owed. The whole balance is the default because it
 * is the usual case; a part payment is possible when the drawer cannot cover
 * the lot, and the account closes itself once nothing is left.
 */
function PayoutDialog({
  open,
  onOpenChange,
  account,
  fetcher,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: SusuAccount;
  fetcher: Fetcher;
}) {
  const [amount, setAmount] = useState("");
  const [key, setKey] = useState("");

  // A fresh key each time it opens, so one intent keeps one key across retries
  // but a second, deliberate payout is never mistaken for a replay of the first.
  useEffect(() => {
    if (!open) return;
    setAmount(toCedisInput(account.payoutRemaining));
    setKey(newIdempotencyKey());
  }, [open, account.payoutRemaining]);

  const pesewas = parseCedis(amount);
  const tooMuch = pesewas != null && pesewas > account.payoutRemaining;
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onOpenChange(false);
  }, [fetcher.state, fetcher.data, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pay out</DialogTitle>
          <DialogDescription>
            GH₵ {formatAmount(account.payoutRemaining)} is owed on this account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label
            htmlFor="payout-amount"
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            Amount · GH₵
          </Label>
          <Input
            id="payout-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={tooMuch ? true : undefined}
            className="tabular"
          />
          {tooMuch && (
            <p className="text-xs text-destructive">
              More than the GH₵ {formatAmount(account.payoutRemaining)} owed.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || tooMuch || pesewas == null || pesewas <= 0}
            onClick={() =>
              fetcher.submit(
                { intent: "payout", amount, idempotencyKey: key },
                { method: "post" },
              )
            }
          >
            <BanknoteArrowUpIcon />
            Pay out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- deposits --- */

function DepositTable({
  rows,
  newestId,
  canManage,
  account,
  fetcher,
}: {
  rows: DepositRow[];
  /** The newest deposit on the account — not merely the newest on this page. */
  newestId: string | null;
  canManage: boolean;
  account: SusuAccount;
  fetcher: Fetcher;
}) {
  // The API takes a correction only on the newest deposit of an account still
  // open to changes, and never on one a transfer created. Anything else comes
  // back 422, so the reason is worked out here and shown rather than guessed at.
  const open = account.status === "active" || account.status === "completed";

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <Th>Date &amp; time</Th>
          <Th>Days</Th>
          <Th className="text-right">Amount</Th>
          <Th className="hidden text-right sm:table-cell">Balance</Th>
          <Th className="hidden md:table-cell">Channel</Th>
          <Th className="hidden lg:table-cell">Recorded by</Th>
          {canManage && <Th className="w-12 text-right">Actions</Th>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="px-4 py-3 whitespace-nowrap">
              <p>{row.at}</p>
              {/* Which slots of the cycle this one filled — the answer to
                  "why did three days move at once". */}
              <p className="tabular text-xs text-muted-foreground">
                {row.seqStart === row.seqEnd
                  ? `Day ${row.seqStart}`
                  : `Days ${row.seqStart}–${row.seqEnd}`}
              </p>
            </TableCell>
            <TableCell className="tabular px-4 py-3">{row.daysCovered}</TableCell>
            <TableCell className="tabular px-4 py-3 text-right font-medium whitespace-nowrap">
              {formatPesewas(row.amount)}
            </TableCell>
            <TableCell className="tabular hidden px-4 py-3 text-right whitespace-nowrap text-muted-foreground sm:table-cell">
              {formatPesewas(row.balance)}
            </TableCell>
            <TableCell className="hidden px-4 py-3 text-muted-foreground md:table-cell">
              {row.channel}
              {row.batched && (
                <span className="text-muted-foreground/70"> · batch</span>
              )}
            </TableCell>
            <TableCell className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
              {row.recordedBy}
            </TableCell>
            {canManage && (
              <TableCell className="px-4 py-3 text-right">
                <DepositActions
                  row={row}
                  account={account}
                  fetcher={fetcher}
                  blocked={whyNotEditable(row, newestId, open)}
                />
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Why this deposit cannot be corrected, or null when it can. Said the way the
 * branch would say it — the clerk needs to know what to do instead, not which
 * endpoint refused.
 */
function whyNotEditable(
  row: DepositRow,
  newestId: string | null,
  open: boolean,
): string | null {
  if (row.transfer) {
    return "This came from a transfer between accounts. Correct it on the transfer, not here.";
  }
  if (!open) return "This account is closed, so its deposits are final.";
  if (row.id !== newestId) {
    return "Only the newest deposit can be corrected. Remove the ones after it first.";
  }
  return null;
}

function DepositActions({
  row,
  account,
  fetcher,
  blocked,
}: {
  row: DepositRow;
  account: SusuAccount;
  fetcher: Fetcher;
  /** Why the actions are unavailable, or null when they are not. */
  blocked: string | null;
}) {
  const editable = blocked === null;
  const [correcting, setCorrecting] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [amount, setAmount] = useState(toCedisInput(row.amount));
  const [reason, setReason] = useState("");

  const pesewas = parseCedis(amount);
  // The corrected amount has to sit on a day boundary too, and the cycle it is
  // re-derived into is the one *without* this deposit in it.
  const issue =
    pesewas == null
      ? "Enter an amount."
      : checkDepositAmount(
          { ...account, depositsCount: account.depositsCount - row.daysCovered },
          pesewas,
        );

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setCorrecting(false);
      setTrashing(false);
    }
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
            <span className="sr-only">Actions for this deposit</span>
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
            disabled={!editable}
            onSelect={(e) => {
              e.preventDefault();
              setAmount(toCedisInput(row.amount));
              setCorrecting(true);
            }}
          >
            <PencilIcon />
            Correct the amount
          </DropdownMenuItem>
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

      <Dialog open={correcting} onOpenChange={setCorrecting}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Correct the deposit</DialogTitle>
            <DialogDescription>
              A data-entry fix. The days covered and the cycle count are worked
              out again from the new amount.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label
              htmlFor="correct-amount"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Amount · GH₵
            </Label>
            <Input
              id="correct-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={issue ? true : undefined}
              className="tabular"
            />
            <p className={cn("text-xs", issue ? "text-destructive" : "text-muted-foreground")}>
              {issue ??
                `${pesewas! / account.dailyAmount} day${pesewas! / account.dailyAmount === 1 ? "" : "s"} at GH₵ ${formatAmount(account.dailyAmount)}.`}
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCorrecting(false)}>
              Cancel
            </Button>
            <Button
              disabled={Boolean(issue) || fetcher.state !== "idle"}
              onClick={() =>
                fetcher.submit(
                  { intent: "correct-deposit", depositId: row.id, amount },
                  { method: "post" },
                )
              }
            >
              Save correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={trashing} onOpenChange={setTrashing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move this deposit to the trash?</AlertDialogTitle>
            <AlertDialogDescription>
              GH₵ {formatAmount(row.amount)} comes back off the account and the
              cycle count drops by {row.daysCovered}. It can be restored while
              nothing newer has taken its place.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label
              htmlFor="deposit-reason"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Reason (optional)
            </Label>
            <Textarea
              id="deposit-reason"
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
                  { intent: "trash-deposit", depositId: row.id, reason },
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

function TrashedDeposits({
  rows,
  fetcher,
}: {
  // No running balance: a trashed deposit has been taken back out of the
  // account, so there is no position after it to state.
  rows: (Omit<DepositRow, "balance"> & { deletedAt: string; reason: string | null })[];
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
          <Th>Days</Th>
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
              <span className="tabular">{row.daysCovered}</span>
              <span className="text-muted-foreground">
                {row.daysCovered === 1 ? " day" : " days"}
              </span>
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
                    <span className="sr-only">Actions for this deposit</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    disabled={fetcher.state !== "idle"}
                    onSelect={() =>
                      fetcher.submit(
                        { intent: "restore-deposit", depositId: row.id },
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

/** The figures an error carries, as one line under the toast. */
function describe(details?: Record<string, unknown>): string | undefined {
  if (!details) return undefined;
  const money = (k: string) =>
    typeof details[k] === "number" ? `GH₵ ${formatAmount(details[k] as number)}` : null;

  const parts = [
    money("required") && `required ${money("required")}`,
    money("dailyAmount") && `daily ${money("dailyAmount")}`,
    money("totalDeposited") && `deposited ${money("totalDeposited")}`,
    money("remaining") && `remaining ${money("remaining")}`,
    money("payoutRemaining") && `owed ${money("payoutRemaining")}`,
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : undefined;
}
