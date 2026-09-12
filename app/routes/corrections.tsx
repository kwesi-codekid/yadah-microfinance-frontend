import {
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { data, Link, useFetcher, useNavigate, useNavigation } from "react-router";
import { toast } from "sonner";

import {
  approveCorrection,
  cancelCorrection,
  listCorrections,
  rejectCorrection,
} from "~/api/corrections";
import { ApiError } from "~/api/error";
import { FilterMenu, StatusPill } from "~/components/listing";
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
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { isOffice } from "~/lib/auth";
import {
  CORRECTION_KINDS,
  CORRECTION_STATUS_BLURBS,
  CORRECTION_STATUS_LABELS,
  CORRECTION_STATUS_TONE,
  CORRECTION_STATUSES,
  KIND_LABELS,
  checkCorrectionReason,
  targetPath,
  type CorrectionKind,
  type CorrectionStatus,
  type TxnCorrection,
} from "~/lib/corrections";
import {
  formatAccraDateTime,
  formatAmount,
  formatCount,
} from "~/lib/format";
import { requireCounter, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/corrections";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Corrections · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = {
  title: "Corrections",
};

/** Ten rows, as the ledger and the payout queue page them. */
const PAGE_SIZE = 10;

const TABS = [
  { key: "pending", label: "Awaiting decision" },
  { key: "approved", label: "Applied" },
  { key: "rejected", label: "Declined" },
  { key: "cancelled", label: "Taken back" },
  { key: "all", label: "All" },
] as const;
type Tab = (typeof TABS)[number]["key"];

interface Filters {
  status: Tab;
  kind: CorrectionKind | "";
}

function readFilters(url: URL): Filters {
  const status = url.searchParams.get("status");
  const kind = url.searchParams.get("kind") as CorrectionKind | null;
  return {
    // The queue opens on what needs a decision, not on everything ever asked.
    status:
      status === "all" || (status && (CORRECTION_STATUSES as string[]).includes(status))
        ? (status as Tab)
        : "pending",
    kind: kind && CORRECTION_KINDS.includes(kind) ? kind : "",
  };
}

function hrefFor(f: Filters, page = 1): string {
  const p = new URLSearchParams();
  if (f.status !== "pending") p.set("status", f.status);
  if (f.kind) p.set("kind", f.kind);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return `/corrections${s ? `?${s}` : ""}`;
}

/**
 * `GET /corrections` — the queue. Counter and office both read it: a teller
 * has to see that a request is already waiting on an entry, and what became
 * of their own. Only the office decides, and only the asker (or the office)
 * takes one back — the menu offers what the reader may do, and the API
 * refuses the rest.
 *
 * The counts come the way every other listing here gets them: one one-row
 * request per status, each carrying its total.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCounter(request);
  const url = new URL(request.url);
  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const scope = { kind: filters.kind || undefined };
    const [list, ...counts] = await Promise.all([
      listCorrections(token, {
        ...scope,
        page,
        limit: PAGE_SIZE,
        status: filters.status === "all" ? undefined : filters.status,
      }),
      ...CORRECTION_STATUSES.map((status) =>
        listCorrections(token, { ...scope, page: 1, limit: 1, status }),
      ),
    ]);
    return { list, counts };
  });

  const byStatus = Object.fromEntries(
    CORRECTION_STATUSES.map((s, i) => [s, result.counts[i].total]),
  ) as Record<CorrectionStatus, number>;

  return data(
    {
      filters,
      page,
      total: result.list.total,
      counts: {
        all: CORRECTION_STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
        ...byStatus,
      },
      canDecide: isOffice(user),
      userId: user.id,
      rows: result.list.items.map(toRow),
    },
    { headers },
  );
}

interface ActionResult {
  ok: boolean;
  message: string;
  description?: string;
}

/**
 * The three things that can happen to a request, from the row menu. Each is
 * confirmed in a dialog before it gets here; a refusal asks for the reason
 * the teller will read.
 */
export async function action({ request }: Route.ActionArgs) {
  const user = await requireCounter(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const intent = String(form.get("intent") ?? "");
  const reason = String(form.get("reason") ?? "").trim();

  if (!id) {
    return data<ActionResult>(
      { ok: false, message: "No correction." },
      { status: 400 },
    );
  }
  if ((intent === "approve" || intent === "reject") && !isOffice(user)) {
    return data<ActionResult>(
      { ok: false, message: "Only the office decides a correction." },
      { status: 403 },
    );
  }
  if (intent === "reject") {
    const issue = checkCorrectionReason(reason);
    if (issue) {
      return data<ActionResult>({ ok: false, message: issue }, { status: 400 });
    }
  }

  try {
    const { data: result, headers } = await withAuth(request, async (token) => {
      if (intent === "approve") {
        const { correction } = await approveCorrection(token, id);
        return {
          message: `Applied. The figure is now GH₵ ${formatAmount(correction.amount)}.`,
          description: `${correction.requestedByName ?? "The teller"} has been told.`,
        };
      }
      if (intent === "reject") {
        const { correction } = await rejectCorrection(token, id, reason);
        return {
          message: "Declined. The figure is unchanged.",
          description: `${correction.requestedByName ?? "The teller"} reads the reason.`,
        };
      }
      if (intent === "cancel") {
        await cancelCorrection(token, id);
        return { message: "Taken back. Nothing was changed." };
      }
      throw new ApiError(400, { code: "BAD_REQUEST", message: "Unknown action." });
    });
    return data<ActionResult>({ ok: true, ...result }, { headers });
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
  kind: CorrectionKind;
  kindLabel: string;
  targetTo: string;
  targetNumber: string;
  targetLabel: string;
  customerId: string;
  customerName: string;
  before: number;
  after: number;
  /** Susu: the days before and after; null for the other kinds. */
  unitsBefore: number | null;
  units: number | null;
  reason: string;
  status: CorrectionStatus;
  pending: boolean;
  requestedById: string;
  requestedBy: string;
  /** Who decided, and what they said — or nothing yet. */
  reviewedBy: string | null;
  reviewedAt: string | null;
  verdict: string | null;
  at: string;
}

function toRow(c: TxnCorrection): Row {
  return {
    id: c.id,
    kind: c.kind,
    kindLabel: KIND_LABELS[c.kind],
    targetTo: targetPath(c),
    targetNumber: c.targetNumber ? `#${c.targetNumber}` : "",
    targetLabel: c.targetLabel ?? "",
    customerId: c.customerId,
    customerName: c.customerName ?? "Customer",
    before: c.amountBefore,
    after: c.amount,
    unitsBefore: c.unitsBefore ?? null,
    units: c.units ?? null,
    reason: c.reason,
    status: c.status,
    pending: c.status === "pending",
    requestedById: c.requestedById,
    requestedBy: c.requestedByName ?? "A teller",
    reviewedBy: c.reviewedByName ?? null,
    reviewedAt: c.reviewedAt ? formatAccraDateTime(c.reviewedAt) : null,
    verdict: c.rejectionReason ?? null,
    at: formatAccraDateTime(c.createdAt),
  };
}

/* -------------------------------------------------------------------- page --- */

/**
 * The queue, drawn as the payout queue is drawn: the filters over the table,
 * the same ⋯ menu on every row. What is particular here is that a row is a
 * change to a figure already on the ledger, so it names both figures and the
 * reason side by side — the office decides from the row, not from a page
 * behind it.
 */
export default function Corrections({ loaderData }: Route.ComponentProps) {
  const { filters, page, total, counts, canDecide, userId, rows } = loaderData;
  const navigation = useNavigation();
  const navigate = useNavigate();
  const fetcher = useFetcher<ActionResult>();

  // The request being decided, and the reason for a refusal. Held here rather
  // than per row: one dialog over the table, opened by whichever menu asked.
  const [deciding, setDeciding] = useState<{
    row: Row;
    intent: "approve" | "reject" | "cancel";
  } | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const { ok, message, description } = fetcher.data;
    if (ok) toast.success(message, { description });
    else toast.error(message, { description });
  }, [fetcher.state, fetcher.data]);

  const busy =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/corrections";

  const columns: Column<Row>[] = [
    {
      key: "at",
      header: "Asked",
      className: "whitespace-nowrap text-muted-foreground",
      cell: (row) => (
        <>
          <p>{row.at}</p>
          <p className="text-xs">by {row.requestedBy}</p>
        </>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (row) => (
        <>
          <Link
            to={row.targetTo}
            prefetch="intent"
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.customerName}
          </Link>
          <p className="text-xs text-muted-foreground">
            {row.kindLabel}
            {row.targetNumber && (
              <span className="tabular"> · {row.targetNumber}</span>
            )}
            {row.targetLabel && (
              <span className="tabular"> · {row.targetLabel}</span>
            )}
          </p>
        </>
      ),
    },
    {
      key: "change",
      header: "Change · GH₵",
      align: "end",
      cell: (row) => (
        <>
          <p className="tabular whitespace-nowrap">
            <span className="text-muted-foreground line-through">
              {formatAmount(row.before)}
            </span>{" "}
            <span className="font-medium">{formatAmount(row.after)}</span>
          </p>
          {row.units !== null && row.unitsBefore !== null && (
            <p className="tabular text-xs text-muted-foreground">
              {row.unitsBefore} to {row.units} day{row.units === 1 ? "" : "s"}
            </p>
          )}
        </>
      ),
    },
    {
      key: "reason",
      header: "Why",
      className: "hidden max-w-72 md:table-cell",
      cell: (row) => (
        <>
          <p className="text-wrap">{row.reason}</p>
          {/* The office's answer sits under the teller's question. */}
          {row.verdict && (
            <p className="text-xs text-wrap text-danger">
              Declined: {row.verdict}
            </p>
          )}
        </>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <>
          <StatusPill
            label={CORRECTION_STATUS_LABELS[row.status]}
            blurb={CORRECTION_STATUS_BLURBS[row.status]}
            tone={CORRECTION_STATUS_TONE[row.status]}
          />
          {row.reviewedBy && (
            <p className="text-xs text-muted-foreground">
              {row.reviewedBy}
              {row.reviewedAt ? ` · ${row.reviewedAt}` : ""}
            </p>
          )}
        </>
      ),
    },
  ];

  return (
    <Page className="max-w-none">
      <TotalsBand counts={counts} />

      <DataTable
        filters={
          <>
            <FilterMenu
              label="Status"
              items={TABS.map((t) => ({
                key: t.key,
                label: t.label,
                count: counts[t.key],
                to: hrefFor({ ...filters, status: t.key }),
              }))}
              active={filters.status}
            />
            <FilterMenu
              label="Kind"
              items={[
                { key: "", label: "All kinds", to: hrefFor({ ...filters, kind: "" }) },
                ...CORRECTION_KINDS.map((k) => ({
                  key: k,
                  label: KIND_LABELS[k],
                  to: hrefFor({ ...filters, kind: k }),
                })),
              ]}
              active={filters.kind}
            />
          </>
        }
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        paging={{
          page,
          pageSize: PAGE_SIZE,
          total,
          onPageChange: (next) =>
            navigate(hrefFor(filters, next), {
              replace: true,
              preventScrollReset: true,
            }),
        }}
        loading={busy}
        rowActions={(row) => (
          <>
            <DropdownMenuItem asChild>
              <Link to={row.targetTo} prefetch="intent">
                <ExternalLinkIcon />
                Open the record
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Drawn and disabled once decided rather than hidden, which is
                how every row menu in this app says "not any more". The office
                sees the two verdicts; everyone sees the taking-back, usable
                only on their own. */}
            {canDecide && (
              <>
                <DropdownMenuItem
                  disabled={!row.pending}
                  onSelect={(event) => {
                    event.preventDefault();
                    setDeciding({ row, intent: "approve" });
                  }}
                >
                  <CheckIcon />
                  Apply the correction
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
                  Decline the correction
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem
              disabled={
                !row.pending || (!canDecide && row.requestedById !== userId)
              }
              onSelect={(event) => {
                event.preventDefault();
                setDeciding({ row, intent: "cancel" });
              }}
            >
              <Undo2Icon />
              Take the request back
            </DropdownMenuItem>
          </>
        )}
        noun={{ one: "correction", many: "corrections" }}
        pageSize={PAGE_SIZE}
        empty={
          filters.status === "pending"
            ? "Nothing is waiting. When a teller asks for a figure to be corrected, it shows up here for a decision."
            : "Nothing here yet."
        }
      />

      <AlertDialog
        open={deciding !== null}
        onOpenChange={(open) => !open && setDeciding(null)}
      >
        <AlertDialogContent>
          {deciding?.intent === "approve" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Apply {deciding.row.requestedBy}'s correction?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  The {deciding.row.kindLabel.toLowerCase()} on{" "}
                  {deciding.row.customerName}'s record becomes GH₵{" "}
                  {formatAmount(deciding.row.after)}
                  {deciding.row.units !== null &&
                    ` — ${deciding.row.units} day${deciding.row.units === 1 ? "" : "s"} —`}{" "}
                  from GH₵ {formatAmount(deciding.row.before)}. Everything built
                  on it moves with it, and {deciding.row.requestedBy} is told.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Not now</AlertDialogCancel>
                <Button
                  disabled={fetcher.state !== "idle"}
                  onClick={() => {
                    const id = deciding.row.id;
                    setDeciding(null);
                    fetcher.submit({ id, intent: "approve" }, { method: "post" });
                  }}
                >
                  <CheckIcon />
                  Apply
                </Button>
              </AlertDialogFooter>
            </>
          )}

          {deciding?.intent === "reject" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Decline {deciding.row.requestedBy}'s correction?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  The figure stays at GH₵ {formatAmount(deciding.row.before)}.{" "}
                  {deciding.row.requestedBy} reads this reason.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-1.5">
                <Label
                  htmlFor="decline-reason"
                  className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
                >
                  Why
                </Label>
                <Textarea
                  id="decline-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="The customer confirmed three days…"
                  maxLength={300}
                  rows={2}
                />
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel>Keep it waiting</AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={
                    fetcher.state !== "idle" ||
                    Boolean(checkCorrectionReason(reason))
                  }
                  onClick={() => {
                    const id = deciding.row.id;
                    setDeciding(null);
                    fetcher.submit(
                      { id, intent: "reject", reason: reason.trim() },
                      { method: "post" },
                    );
                  }}
                >
                  Decline
                </Button>
              </AlertDialogFooter>
            </>
          )}

          {deciding?.intent === "cancel" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Take the request back?</AlertDialogTitle>
                <AlertDialogDescription>
                  Nothing changes. The figure stays at GH₵{" "}
                  {formatAmount(deciding.row.before)} and can be asked about
                  again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <Button
                  variant="outline"
                  disabled={fetcher.state !== "idle"}
                  onClick={() => {
                    const id = deciding.row.id;
                    setDeciding(null);
                    fetcher.submit({ id, intent: "cancel" }, { method: "post" });
                  }}
                >
                  <Undo2Icon />
                  Take it back
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

/** What is waiting, what got through, and what did not. */
function TotalsBand({
  counts,
}: {
  counts: Record<CorrectionStatus | "all", number>;
}) {
  return (
    <dl className="mb-4 grid gap-4 sm:grid-cols-3">
      <Tile
        value={formatCount(counts.pending)}
        label="Awaiting decision"
        icon={<ClockIcon />}
        tone="warning"
      />
      <Tile
        value={formatCount(counts.approved)}
        label="Applied"
        icon={<CheckIcon />}
        tone="success"
      />
      <Tile
        value={formatCount(counts.rejected)}
        label="Declined"
        icon={<XIcon />}
        tone="danger"
      />
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
  tone: "success" | "danger" | "warning";
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4">
      <div>
        <dd className="tabular font-heading text-3xl font-bold tracking-tight">
          {value}
        </dd>
        <dt className="mt-0.5 text-sm text-muted-foreground">{label}</dt>
      </div>
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
          tone === "success" && "bg-success-subtle text-success",
          tone === "danger" && "bg-danger-subtle text-danger",
          tone === "warning" && "bg-warning-subtle text-warning",
        )}
        aria-hidden
      >
        {icon}
      </span>
    </div>
  );
}
