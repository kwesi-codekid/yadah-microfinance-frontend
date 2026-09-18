import {
  BanknoteArrowUpIcon,
  CheckIcon,
  ClockIcon,
  RefreshCwIcon,
  SendIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { data, Link, useFetcher, useLocation, useNavigation, useSubmit } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import {
  approvePayoutRequest,
  listPayoutRequests,
  rejectPayoutRequest,
  verifyPayoutTransfer,
} from "~/api/payout-requests";
import {
  FilterMenu,
  type MenuChoice,
  StatusPill,
} from "~/components/listing";
import { Page } from "~/components/page";
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
import { DataTable, type Column } from "~/components/ui/data-table";
import { DropdownMenuItem, DropdownMenuSeparator } from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  formatAccraDate,
  formatAccraDateTime,
  formatAmount,
  formatCount,
  formatPesewas,
} from "~/lib/format";
import {
  KIND_LABELS,
  STATUS_BLURBS,
  STATUS_LABELS,
  STATUS_TONE,
  STATUSES,
  canVerify,
  checkRejectionReason,
  isPending,
  isStranded,
  outcomeFor,
  providerLabel,
  type Outcome,
  targetPath,
  type PayoutRequest,
  type PayoutRequestStatus,
} from "~/lib/payout-requests";
import { requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/payout-requests";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Payout requests · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = {
  title: "Payout requests",
};

/** Ten rows, as the ledger and the sales book page them. */
const PAGE_SIZE = 10;

const TABS = [
  { key: "pending", label: "Awaiting decision" },
  { key: "failed", label: "Transfer failed" },
  { key: "approved", label: "Sending" },
  { key: "paid", label: "Paid" },
  { key: "rejected", label: "Declined" },
  { key: "all", label: "All" },
] as const;
type Tab = (typeof TABS)[number]["key"];

interface Filters {
  status: Tab;
}

function readFilters(url: URL): Filters {
  const statusParam = url.searchParams.get("status") as PayoutRequestStatus | "all" | null;
  return {
    // The queue opens on what needs a decision, not on everything ever asked.
    status: statusParam === "all" || (statusParam && STATUSES.includes(statusParam))
      ? statusParam
      : "pending",
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status !== "pending") p.set("status", f.status);
  if (page > 1) p.set("page", String(page));
  return p;
}

/**
 * `GET /payout-requests` — the queue. Office only.
 *
 * The status counts are fetched the way every other listing here does it: one
 * one-row request per status. This endpoint answers `{ items }` without a
 * total, so a count is the page-1 length capped at the page size — exact up to
 * a hundred, and "100+" is all anyone needs to know past that.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const [list, ...counts] = await Promise.all([
      listPayoutRequests(token, {
        page,
        limit: PAGE_SIZE,
        status: filters.status === "all" ? undefined : filters.status,
      }),
      ...STATUSES.map((status) => listPayoutRequests(token, { page: 1, limit: 100, status })),
    ]);
    return { list, counts };
  });

  const byStatus = Object.fromEntries(
    STATUSES.map((s, i) => [s, result.counts[i].items.length]),
  ) as Record<PayoutRequestStatus, number>;

  const stranded = result.counts[STATUSES.indexOf("failed")].items.reduce(
    (sum, r) => sum + (r.netAmount ?? r.amount ?? 0),
    0,
  );

  return data(
    {
      filters,
      page,
      total: result.list.total,
      counts: {
        all: STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
        ...byStatus,
      },
      stranded,
      rows: result.list.items.map(toRow),
    },
    { headers },
  );
}

type ActionResult = Outcome;

/**
 * The three things the office can do to a request, from the row menu. The
 * decisions are confirmed in a dialog before they get here; verifying is
 * harmless to press twice, so it is not.
 */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const intent = String(form.get("intent") ?? "");
  const reason = String(form.get("reason") ?? "").trim();

  if (!id) {
    return data<ActionResult>({ ok: false, message: "No request." }, { status: 400 });
  }
  if (intent === "reject") {
    const issue = checkRejectionReason(reason);
    if (issue) return data<ActionResult>({ ok: false, message: issue }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) => {
      if (intent === "approve") return approvePayoutRequest(token, id);
      if (intent === "reject") return rejectPayoutRequest(token, id, reason);
      if (intent === "verify") return verifyPayoutTransfer(token, id);
      throw new ApiError(400, { code: "BAD_REQUEST", message: "Unknown action." });
    });
    return data<ActionResult>(outcomeFor(intent, result.request), { headers });
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
  customerId: string;
  customerName: string;
  kind: string;
  targetTo: string;
  amount: number | null;
  net: number | null;
  wallet: string;
  status: PayoutRequestStatus;
  pending: boolean;
  stranded: boolean;
  verifiable: boolean;
  note: string;
  date: string;
  time: string;
}

function toRow(r: PayoutRequest): Row {
  return {
    id: r.id,
    customerId: r.customerId,
    customerName: r.customerName ?? "Customer",
    kind: KIND_LABELS[r.kind] ?? r.kind,
    targetTo: targetPath(r),
    amount: r.amount,
    net: r.netAmount,
    wallet: `${providerLabel(r.payoutProvider)} · ${r.payoutPhone}`,
    status: r.status,
    pending: isPending(r),
    stranded: isStranded(r),
    verifiable: canVerify(r),
    note: r.failureReason || r.rejectionReason || "",
    date: formatAccraDate(r.createdAt),
    time: formatAccraDateTime(r.createdAt).split(", ")[1] ?? "",
  };
}

/* -------------------------------------------------------------------- page --- */

/**
 * The queue, drawn as the sales book is drawn: the same KPI cards over it, the
 * same table, the same ⋯ menu on every row. What is particular here is that
 * the two things the menu can do both move money or refuse it, so both sit
 * behind a confirmation — and a refusal asks for the reason the customer will
 * read.
 */
export default function PayoutRequests({ loaderData }: Route.ComponentProps) {
  const { filters, page, total, counts, stranded, rows } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const fetcher = useFetcher<ActionResult>();
  const { search } = useLocation();

  // The request being decided, and the reason for a refusal. Held here rather
  // than per row: one dialog over the table, opened by whichever menu asked.
  const [deciding, setDeciding] = useState<{ row: Row; intent: "approve" | "reject" } | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!fetcher.data) return;
    const { ok, message, description } = fetcher.data;
    if (ok) toast.success(message, { description });
    else toast.error(message, { description });
  }, [fetcher.data]);

  const busy =
    navigation.state === "loading" && navigation.location?.pathname === "/payout-requests";

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), { replace: true, preventScrollReset: true });

  const goToPage = (next: number) =>
    submit(queryFor(filters, next), { replace: true, preventScrollReset: true });

  const items: MenuChoice[] = TABS.map((t) => ({
    key: t.key,
    label: t.label,
    count: counts[t.key],
    onSelect: () => apply({ status: t.key }),
  }));

  const columns: Column<Row>[] = [
    {
      key: "date",
      header: "Asked",
      className: "whitespace-nowrap text-muted-foreground",
      cell: (row) => (
        <>
          <p>{row.date}</p>
          <p className="text-xs">{row.time}</p>
        </>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (row) => (
        <>
          <Link
            to={`/payout-requests/${row.id}${search}`}
            prefetch="intent"
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.customerName}
          </Link>
          <p className="text-xs text-muted-foreground">{row.wallet}</p>
        </>
      ),
    },
    {
      key: "kind",
      header: "Request",
      className: "hidden md:table-cell",
      cell: (row) => (
        <Link to={row.targetTo} prefetch="intent" className="underline-offset-4 hover:underline">
          {row.kind}
        </Link>
      ),
    },
    {
      key: "amount",
      header: "Asked for · GH₵",
      align: "end",
      // Null means a closure: the payout is whatever the cycle comes to once
      // the commission is taken, and nobody typed a figure.
      cell: (row) =>
        row.amount == null ? (
          <span className="text-muted-foreground" title="A closure pays out what is held, less commission.">
            Whole balance
          </span>
        ) : (
          <span className="tabular font-medium">{formatAmount(row.amount)}</span>
        ),
    },
    {
      key: "net",
      header: "Sent · GH₵",
      align: "end",
      className: "tabular hidden lg:table-cell",
      cell: (row) =>
        row.net == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={cn(row.stranded && "font-medium text-danger")}>{formatAmount(row.net)}</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusPill
          label={STATUS_LABELS[row.status]}
          blurb={row.note || STATUS_BLURBS[row.status]}
          tone={STATUS_TONE[row.status]}
        />
      ),
    },
  ];

  return (
    <Page className="max-w-none">
      <TotalsBand counts={counts} stranded={stranded} />

      <DataTable
        filters={<FilterMenu label="Status" items={items} active={filters.status} />}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        paging={{ page, pageSize: PAGE_SIZE, total, onPageChange: goToPage }}
        loading={busy}
        rowActions={(row) => (
          <>
            <DropdownMenuItem asChild>
              <Link to={`/payout-requests/${row.id}${search}`} prefetch="intent">
                <BanknoteArrowUpIcon />
                Open the request
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to={row.targetTo} prefetch="intent">
                <ClockIcon />
                Open the account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Drawn and disabled once decided rather than hidden, which is
                how every row menu in this app says "not any more". */}
            <DropdownMenuItem
              disabled={!row.pending}
              onSelect={(event) => {
                event.preventDefault();
                setDeciding({ row, intent: "approve" });
              }}
            >
              <CheckIcon />
              Approve and send
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={!row.pending}
              onSelect={(event) => {
                event.preventDefault();
                setReason("");
                setDeciding({ row, intent: "reject" });
              }}
            >
              <XIcon />
              Decline
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!row.verifiable || fetcher.state !== "idle"}
              onSelect={() => fetcher.submit({ id: row.id, intent: "verify" }, { method: "post" })}
            >
              <RefreshCwIcon />
              Verify with Paystack
            </DropdownMenuItem>
          </>
        )}
        noun={{ one: "request", many: "requests" }}
        pageSize={PAGE_SIZE}
        empty={
          filters.status === "pending"
            ? "Nothing is waiting. When a customer asks for a withdrawal on the portal, it shows up here for a decision."
            : filters.status === "failed"
              ? "No transfer has failed. That is the state to watch — it means an account was debited and the money did not arrive."
              : "Nothing here yet."
        }
      />

      <AlertDialog open={deciding !== null} onOpenChange={(open) => !open && setDeciding(null)}>
        <AlertDialogContent>
          {deciding?.intent === "approve" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Send {deciding.row.amount == null ? "the whole balance" : formatPesewas(deciding.row.amount)} to{" "}
                  {deciding.row.customerName}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  The account is debited, then Paystack sends the money to{" "}
                  {deciding.row.wallet}. A failed transfer keeps the debit and shows
                  under <span className="font-medium text-foreground">Transfer failed</span>.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Not yet</AlertDialogCancel>
                <Button
                  onClick={() => {
                    const id = deciding.row.id;
                    setDeciding(null);
                    fetcher.submit({ id, intent: "approve" }, { method: "post" });
                  }}
                >
                  <SendIcon />
                  Approve and send
                </Button>
              </AlertDialogFooter>
            </>
          )}

          {deciding?.intent === "reject" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Decline {deciding.row.customerName}'s request?</AlertDialogTitle>
                <AlertDialogDescription>
                  Nothing moves. The customer reads this reason on the portal.
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
                  placeholder="Come to the office with your ID"
                  maxLength={500}
                  autoComplete="off"
                />
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={Boolean(checkRejectionReason(reason))}
                  onClick={() => {
                    const id = deciding.row.id;
                    setDeciding(null);
                    fetcher.submit({ id, intent: "reject", reason: reason.trim() }, { method: "post" });
                  }}
                >
                  Decline the request
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

/* ------------------------------------------------------------------ totals --- */

/**
 * The three figures the office asks for first: what is waiting, what went
 * wrong, and what got through. The stranded amount is the one that matters —
 * it is money off the books that is not in anyone's pocket.
 */
function TotalsBand({
  counts,
  stranded,
}: {
  counts: Record<PayoutRequestStatus | "all", number>;
  stranded: number;
}) {
  return (
    <dl className="mb-4 grid gap-4 sm:grid-cols-3">
      <Tile value={formatCount(counts.pending)} label="Awaiting decision" icon={<ClockIcon />} tone="info" />
      <Tile
        value={counts.failed > 0 ? formatPesewas(stranded) : "0"}
        label={counts.failed > 0 ? `Stranded in ${formatCount(counts.failed)} failed transfer${counts.failed === 1 ? "" : "s"}` : "Failed transfers"}
        icon={<TriangleAlertIcon />}
        tone="danger"
      />
      <Tile value={formatCount(counts.paid)} label="Paid out" icon={<CheckIcon />} tone="success" />
    </dl>
  );
}

/** A big number, a label under it, and the icon boxed top-right. */
function Tile({
  value,
  label,
  icon,
  tone,
}: {
  value: string;
  label: string;
  icon: React.ReactNode;
  tone: "success" | "danger" | "info";
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4">
      <div>
        <dd className="tabular font-heading text-3xl font-bold tracking-tight">{value}</dd>
        <dt className="mt-0.5 text-sm text-muted-foreground">{label}</dt>
      </div>
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
          tone === "success" && "bg-success-subtle text-success",
          tone === "danger" && "bg-danger-subtle text-danger",
          tone === "info" && "bg-info-subtle text-info",
        )}
        aria-hidden
      >
        {icon}
      </span>
    </div>
  );
}
