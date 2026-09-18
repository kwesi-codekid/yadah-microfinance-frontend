import {
  BanknoteIcon,
  CheckIcon,
  ExternalLinkIcon,
  LandmarkIcon,
  PlusIcon,
  ReceiptTextIcon,
  TagIcon,
  WalletIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  data,
  Link,
  Outlet,
  useFetcher,
  useLocation,
  useNavigation,
  useSubmit,
} from "react-router";
import { toast } from "sonner";

import { listCashAccounts } from "~/api/accounting";
import {
  approveExpense,
  getExpenseSummary,
  listExpenses,
  payExpense,
  rejectExpense,
} from "~/api/expenses";
import { ApiError } from "~/api/error";
import {
  ChoiceFilter,
  DayRangeFilter,
  ExportMenu,
  Figure,
  SearchBox,
  StatusPill,
} from "~/components/listing";
import { Page } from "~/components/page";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
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
import { DataTable, type Column, type TableTab } from "~/components/ui/data-table";
import { DateField } from "~/components/ui/date-field";
import { DropdownMenuItem, DropdownMenuSeparator } from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  canApproveBy,
  canDecide,
  canPay,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_OPTIONS,
  EXPENSE_STATUS_BLURBS,
  EXPENSE_STATUS_LABELS,
  EXPENSE_STATUS_TONE,
  EXPENSE_STATUSES,
  WRITE_OFF_LABELS,
  type Expense,
  type ExpenseCategory,
  type ExpenseStatus,
} from "~/lib/accounting";
import { accraDay, formatAccraDate, formatCount, formatPesewas } from "~/lib/format";
import { isOffice } from "~/lib/auth";
import { requireCounter, requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/expenses";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Expenses · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = {
  title: "Expenses",
};

/** Ten rows, as the ledger and every other book page them. */
const PAGE_SIZE = 10;

const TABS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "paid", label: "Paid" },
  { key: "rejected", label: "Rejected" },
] as const;
type Tab = (typeof TABS)[number]["key"];

interface Filters {
  status: Tab;
  category: ExpenseCategory | "";
  account: string;
  search: string;
  from: string;
  to: string;
}

function readFilters(url: URL): Filters {
  const status = url.searchParams.get("status") as ExpenseStatus | null;
  const category = url.searchParams.get("category") as ExpenseCategory | null;
  return {
    status: status && EXPENSE_STATUSES.includes(status) ? status : "all",
    category: category && EXPENSE_CATEGORIES.includes(category) ? category : "",
    account: url.searchParams.get("account")?.trim() ?? "",
    search: url.searchParams.get("search")?.trim() ?? "",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status !== "all") p.set("status", f.status);
  if (f.category) p.set("category", f.category);
  if (f.account) p.set("account", f.account);
  if (f.search) p.set("search", f.search);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (page > 1) p.set("page", String(page));
  return p;
}

/** What the API wants, from what the URL says. */
function paramsFor(f: Filters) {
  return {
    category: f.category || undefined,
    cashAccountId: f.account || undefined,
    search: f.search || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
  };
}

/**
 * `GET /expenses` — the book of costs.
 *
 * The counter reads and records; the office decides and pays.
 *
 * The tab counts are one one-row request per status, scoped by the same
 * filters as the rows, so a count never contradicts the list under it. The
 * accounts are read alongside because paying is done from this page and has to
 * name one.
 */
export async function loader({ request }: Route.LoaderArgs) {
  // Reading and recording are the counter's — petty cash leaves the drawer all
  // day, and a book only the office can open is written up on Friday from a
  // pocketful of receipts. Deciding and paying are checked in the action.
  const user = await requireCounter(request);
  const url = new URL(request.url);

  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const scope = paramsFor(filters);
    const [list, accounts, summary, ...counts] = await Promise.all([
      listExpenses(token, {
        ...scope,
        page,
        limit: PAGE_SIZE,
        status: filters.status === "all" ? undefined : filters.status,
      }),
      listCashAccounts(token),
      // The month so far, over the whole book rather than this page of it: a
      // filtered total would make the branch look like it spent less than it
      // did. A missing summary must not take the book down with it.
      getExpenseSummary(token, { from: monthStart(), to: accraDay() }).catch(() => null),
      ...EXPENSE_STATUSES.map((status) =>
        listExpenses(token, { ...scope, page: 1, limit: 1, status }),
      ),
    ]);
    return { list, accounts, summary, counts };
  });

  const byStatus = Object.fromEntries(
    EXPENSE_STATUSES.map((s, i) => [s, result.counts[i].total]),
  ) as Record<ExpenseStatus, number>;

  const accountNames = new Map(result.accounts.map((a) => [a.id, a.name]));

  return data(
    {
      userId: user.id,
      filters,
      page,
      total: result.list.total,
      counts: {
        all: EXPENSE_STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
        ...byStatus,
      },
      rows: result.list.items.map((e) => toRow(e, user.id, accountNames)),
      accounts: result.accounts
        .filter((a) => (a.status ?? "active") === "active")
        .map((a) => ({ id: a.id, name: a.name })),
      accountName: filters.account ? (accountNames.get(filters.account) ?? null) : null,
      summary: result.summary,
      filteredAmount: result.list.totalAmount,
    },
    { headers },
  );
}

/** The first day of this month, in the Accra calendar the API counts by. */
function monthStart(): string {
  const now = new Date();
  return accraDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
}

/** Opening the record drawer does not re-read the book underneath it. */
export const shouldRevalidate = drawerParentShouldRevalidate;

interface ActionResult {
  ok: boolean;
  message: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The three decisions, from the row menu. Recording is the drawer.
 *
 * Approving is refused by the API when the approver recorded the expense —
 * the menu already disables it for them, so a `403` here is somebody else's
 * session having changed underneath. Paying is the one intent that moves
 * money, and the only one that names an account.
 */
export async function action({ request }: Route.ActionArgs) {
  // Every action on this route decides or pays, so all of them are the
  // office's. Recording is a different route.
  await requireOffice(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  if (!id) {
    return data<ActionResult>({ ok: false, message: "No expense." }, { status: 400 });
  }

  try {
    if (intent === "approve") {
      const { headers } = await withAuth(request, (token) => approveExpense(token, id));
      return data<ActionResult>(
        { ok: true, message: "Approved. It can be paid now." },
        { headers },
      );
    }
    if (intent === "reject") {
      const reason = String(form.get("reason") ?? "").trim();
      if (!reason) {
        return data<ActionResult>(
          { ok: false, message: "Say why it is being rejected." },
          { status: 400 },
        );
      }
      const { headers } = await withAuth(request, (token) =>
        rejectExpense(token, id, reason),
      );
      return data<ActionResult>(
        { ok: true, message: "Rejected. Nothing moved." },
        { headers },
      );
    }
    if (intent === "pay") {
      const cashAccountId = String(form.get("cashAccountId") ?? "").trim();
      const paidOn = String(form.get("paidOn") ?? "").trim();
      if (!cashAccountId) {
        return data<ActionResult>(
          { ok: false, message: "Name the account the money leaves." },
          { status: 400 },
        );
      }
      if (paidOn && !DAY_RE.test(paidOn)) {
        return data<ActionResult>(
          { ok: false, message: "Pick a valid day it was paid on." },
          { status: 400 },
        );
      }
      const { data: result, headers } = await withAuth(request, (token) =>
        payExpense(token, id, { cashAccountId, paidOn: paidOn || undefined }),
      );
      return data<ActionResult>(
        {
          ok: true,
          message: `${formatPesewas(result.expense.amount)} paid. The cash position has moved.`,
        },
        { headers },
      );
    }
    return data<ActionResult>({ ok: false, message: "Unknown action." }, { status: 400 });
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

/* -------------------------------------------------------------------- rows --- */

interface Row {
  id: string;
  description: string;
  category: ExpenseCategory;
  categoryLabel: string;
  payee: string;
  reference: string;
  amount: number;
  incurredOn: string;
  status: ExpenseStatus;
  recordedBy: string;
  approvedBy: string;
  paidFrom: string;
  paidOn: string;
  rejectionReason: string;
  receiptUrl: string;
  writeOffPath: string | null;
  writeOffLabel: string;
  approvable: boolean;
  decidable: boolean;
  payable: boolean;
  mine: boolean;
}

function toRow(e: Expense, userId: string, accountNames: Map<string, string>): Row {
  const day = (d?: string) => (d ? formatAccraDate(`${d}T12:00:00Z`) : "");
  return {
    id: e.id,
    description: e.description,
    category: e.category,
    categoryLabel: EXPENSE_CATEGORY_LABELS[e.category] ?? e.category,
    payee: e.payee ?? "",
    reference: e.reference ?? "",
    amount: e.amount,
    incurredOn: day(e.incurredOn),
    status: e.status,
    recordedBy: e.recordedByName ?? (e.recordedById === userId ? "You" : "Staff"),
    approvedBy: e.approvedByName ?? "",
    paidFrom: e.cashAccountId ? (accountNames.get(e.cashAccountId) ?? "An account") : "",
    paidOn: day(e.paidOn),
    rejectionReason: e.rejectionReason ?? "",
    receiptUrl: e.receiptUrl ?? "",
    writeOffPath:
      e.writeOffEntityType === "loan" && e.writeOffEntityId
        ? `/loans/${e.writeOffEntityId}`
        : e.writeOffEntityType === "hp-agreement" && e.writeOffEntityId
          ? `/hire-purchase/${e.writeOffEntityId}`
          : null,
    writeOffLabel: e.writeOffEntityType ? WRITE_OFF_LABELS[e.writeOffEntityType] : "",
    approvable: canApproveBy(e, userId),
    decidable: canDecide(e),
    payable: canPay(e),
    mine: e.recordedById === userId,
  };
}

/* -------------------------------------------------------------------- page --- */

/**
 * The book of costs, drawn as every other book is: the same toolbar, the same
 * ⋯ menu on every row, the same ten-row footer. What is particular to an
 * expense is that it passes through three hands — recorded, approved, paid —
 * and the row says which hand it is waiting on.
 */
export default function AccountingExpenses({ loaderData }: Route.ComponentProps) {
  const { filters, page, total, counts, rows, accounts, accountName, summary, filteredAmount } =
    loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const fetcher = useFetcher<ActionResult>();
  const { search } = useLocation();

  // One dialog over the table, opened by whichever menu asked for it.
  const [rejecting, setRejecting] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [paying, setPaying] = useState<Row | null>(null);
  const [payFrom, setPayFrom] = useState(accounts[0]?.id ?? "");

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) toast.success(fetcher.data.message);
    else toast.error(fetcher.data.message);
  }, [fetcher.data]);

  const busy =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/expenses";

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), {
      replace: true,
      preventScrollReset: true,
    });

  const goToPage = (next: number) =>
    submit(queryFor(filters, next), { replace: true, preventScrollReset: true });

  const tabs: TableTab[] = TABS.map((t) => ({
    value: t.key,
    label: t.label,
    count: counts[t.key],
  }));

  const narrowed = Boolean(
    filters.search || filters.category || filters.account || filters.from || filters.to,
  );

  const columns: Column<Row>[] = [
    {
      key: "incurred",
      header: "Incurred",
      className: "whitespace-nowrap text-muted-foreground",
      cell: (row) => row.incurredOn,
    },
    {
      key: "what",
      header: "What",
      cell: (row) => (
        <div className="min-w-0">
          <Link
            to={`/expenses/${row.id}`}
            className="truncate font-medium underline-offset-4 hover:underline"
          >
            {row.description}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {row.categoryLabel}
            {row.payee ? ` · ${row.payee}` : ""}
            {row.reference ? ` · ${row.reference}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "hands",
      header: "Recorded · Approved",
      className: "hidden text-muted-foreground lg:table-cell",
      cell: (row) => (
        <>
          <p className="truncate">{row.recordedBy}</p>
          <p className="truncate text-xs">
            {row.approvedBy ? `Approved by ${row.approvedBy}` : row.decidable ? "Awaiting approval" : ""}
          </p>
        </>
      ),
    },
    {
      key: "paid",
      header: "Paid from",
      className: "hidden text-muted-foreground md:table-cell",
      cell: (row) =>
        row.paidFrom ? (
          <>
            <p className="truncate">{row.paidFrom}</p>
            {row.paidOn && <p className="text-xs">{row.paidOn}</p>}
          </>
        ) : (
          "—"
        ),
    },
    {
      key: "amount",
      header: "Amount · GH₵",
      align: "end",
      cell: (row) => (
        <span
          className={cn(
            "tabular font-medium",
            row.status === "rejected" && "text-muted-foreground line-through",
            row.status === "paid" && "text-cash-out",
          )}
        >
          {formatPesewas(row.amount)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusPill
          label={EXPENSE_STATUS_LABELS[row.status]}
          blurb={row.rejectionReason || EXPENSE_STATUS_BLURBS[row.status]}
          tone={EXPENSE_STATUS_TONE[row.status]}
        />
      ),
    },
  ];

  // The three largest categories, which is as much as a strip can say without
  // becoming a report. Everything else is one line.
  const top = summary?.byCategory.slice(0, 3) ?? [];
  const rest = (summary?.byCategory.length ?? 0) - top.length;

  return (
    <Page className="max-w-none">
      {/* What the branch has spent this month, and what it still owes on it.
          Over the whole book, not the filtered page: a total that moved when
          somebody picked a category would be a total nobody could quote. */}
      {summary && (
        <section className="mb-6">
          <dl className="grid gap-3 sm:grid-cols-3">
            <Figure
              label="Spent this month"
              value={formatPesewas(summary.totalAmount)}
              hint={`${formatCount(summary.totalCount)} expense${summary.totalCount === 1 ? "" : "s"}, rejected ones excluded`}
              tone="warning"
            />
            <Figure
              label="Still owed"
              value={formatPesewas(summary.outstandingAmount)}
              hint="Incurred but not yet paid out"
              tone={summary.outstandingAmount > 0 ? "info" : "muted"}
            />
            <Figure
              label="Biggest category"
              value={top[0] ? EXPENSE_CATEGORY_LABELS[top[0].category] : "—"}
              hint={top[0] ? formatPesewas(top[0].amount) : "Nothing recorded yet"}
              tone="muted"
            />
          </dl>

          {top.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {top
                .map(
                  (entry) =>
                    `${EXPENSE_CATEGORY_LABELS[entry.category]} ${formatPesewas(entry.amount)}`,
                )
                .join(" · ")}
              {rest > 0 && ` · ${formatCount(rest)} more`}
            </p>
          )}
        </section>
      )}

      <DataTable
        actions={
          <>
            <ChoiceFilter
              value={filters.category}
              options={EXPENSE_CATEGORY_OPTIONS}
              apply={(next) => apply({ category: next })}
              title="Category"
              allLabel="Every category"
              icon={<TagIcon />}
              width="w-64"
            />
            {filters.account && (
              <Button
                variant="outline"
                size="sm"
                className="border-primary/50 text-primary"
                onClick={() => apply({ account: "" })}
                aria-label="Stop filtering by account"
              >
                <WalletIcon />
                {accountName ?? "One account"}
                <XIcon />
              </Button>
            )}
            <DayRangeFilter
              from={filters.from}
              to={filters.to}
              apply={(next) => apply(next)}
              title="Incurred"
            />
            <ExportMenu
              path="/expenses/export"
              query={queryFor(filters).toString()}
              total={total}
              noun="expense"
            />
            <Button asChild size="sm">
              <Link to={`/expenses/new${search}`} prefetch="intent" preventScrollReset>
                <PlusIcon />
                Record expense
              </Link>
            </Button>
          </>
        }
        tabs={tabs}
        activeTab={filters.status}
        onTabChange={(value) => apply({ status: value as Tab })}
        tabsLabel="Filter expenses by status"
        searchSlot={
          <SearchBox
            value={filters.search}
            apply={(next) => apply({ search: next })}
            hidden={{
              status: filters.status === "all" ? "" : filters.status,
              category: filters.category,
              account: filters.account,
              from: filters.from,
              to: filters.to,
            }}
            placeholder="Description, payee or reference"
            label="Search expenses"
            busy={busy}
          />
        }
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        paging={{ page, pageSize: PAGE_SIZE, total, onPageChange: goToPage }}
        loading={busy}
        rowActions={(row) => (
          <>
            <DropdownMenuItem asChild>
              <Link to={`/expenses/${row.id}`}>Open</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Disabled rather than absent: the same menu on every row, so the
                sequence — approve, then pay — is legible from the menu itself. */}
            <DropdownMenuItem
              disabled={!row.approvable}
              onSelect={() => fetcher.submit({ intent: "approve", id: row.id }, { method: "post" })}
            >
              <CheckIcon />
              {row.decidable && row.mine ? "Approve (not your own)" : "Approve"}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!row.decidable}
              onSelect={(event) => {
                event.preventDefault();
                setReason("");
                setRejecting(row);
              }}
            >
              <XIcon />
              Reject
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!row.payable || accounts.length === 0}
              onSelect={(event) => {
                event.preventDefault();
                setPayFrom(accounts[0]?.id ?? "");
                setPaying(row);
              }}
            >
              <BanknoteIcon />
              {accounts.length === 0 ? "Pay (no account to pay from)" : "Pay"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {row.writeOffPath ? (
              <DropdownMenuItem asChild>
                <Link to={row.writeOffPath}>
                  <LandmarkIcon />
                  Open the {row.writeOffLabel.toLowerCase()} written off
                </Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>
                <LandmarkIcon />
                Not a write-off
              </DropdownMenuItem>
            )}
            {row.receiptUrl ? (
              <DropdownMenuItem asChild>
                <a href={row.receiptUrl} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon />
                  Open the receipt
                </a>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>
                <ReceiptTextIcon />
                No receipt attached
              </DropdownMenuItem>
            )}
          </>
        )}
        noun={{ one: "expense", many: "expenses" }}
        pageSize={PAGE_SIZE}
        empty={
          narrowed
            ? "Nothing matches these filters. Widen them, or clear them to see every expense."
            : filters.status === "all"
              ? "No costs recorded yet. Record one and it waits here for someone else to approve it."
              : `Nothing ${EXPENSE_STATUS_LABELS[filters.status].toLowerCase()}.`
        }
      />

      {/* Reject: a reason is required, and it shows on the row afterwards. */}
      <AlertDialog
        open={rejecting !== null}
        onOpenChange={(open) => !open && setRejecting(null)}
      >
        <AlertDialogContent>
          {rejecting && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Reject this expense?</AlertDialogTitle>
                <AlertDialogDescription>
                  {formatPesewas(rejecting.amount)} for {rejecting.description} is marked
                  rejected with this reason. Nothing moves.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-1.5">
                <Label htmlFor="reject-reason" className="eyebrow text-muted-foreground">
                  Why<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Input
                  id="reject-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Duplicate of last week’s"
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
                    const id = rejecting.id;
                    setRejecting(null);
                    fetcher.submit(
                      { intent: "reject", id, reason: reason.trim() },
                      { method: "post" },
                    );
                  }}
                >
                  Reject it
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* Pay: the one step that moves money, so it names the account and the day. */}
      <AlertDialog open={paying !== null} onOpenChange={(open) => !open && setPaying(null)}>
        <AlertDialogContent>
          {paying && (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="pay" />
              <input type="hidden" name="id" value={paying.id} />
              <AlertDialogHeader>
                <AlertDialogTitle>Pay {formatPesewas(paying.amount)}?</AlertDialogTitle>
                <AlertDialogDescription>
                  {paying.description}. The account named here drops by the amount.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="my-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pay-account" className="eyebrow text-muted-foreground">
                    From<span className="ml-0.5 text-destructive">*</span>
                  </Label>
                  <Select name="cashAccountId" value={payFrom} onValueChange={setPayFrom}>
                    <SelectTrigger id="pay-account" className="w-full">
                      <SelectValue placeholder="Select an account" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pay-on" className="eyebrow text-muted-foreground">
                    Paid on
                  </Label>
                  <DateField
                    id="pay-on"
                    name="paidOn"
                    defaultValue={accraDay()}
                    endMonth={new Date()}
                  />
                </div>
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel type="button">Not yet</AlertDialogCancel>
                <Button type="submit" disabled={!payFrom} onClick={() => setPaying(null)}>
                  Pay it
                </Button>
              </AlertDialogFooter>
            </fetcher.Form>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* Recording renders here, over the book. */}
      <Outlet />
    </Page>
  );
}
