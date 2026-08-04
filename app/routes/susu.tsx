import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useNavigation,
  useNavigationType,
  useSearchParams,
} from "react-router";
import { Button } from "@heroui/react";
import {
  ArrowLeftRight,
  ChevronRight,
  Coins,
  CornerDownRight,
  Eye,
  LoaderCircle,
  Plus,
  Search,
} from "lucide-react";
import type { Route } from "./+types/susu";
import { SusuStatusPill } from "~/components/account-status";
import {
  CustomerPicker,
  type CustomerMatch,
} from "~/components/customer-picker";
import { DataTable, Table } from "~/components/data-table";
import {
  FIELD,
  FieldError,
  IconAction,
  IconLink,
} from "~/components/form-fields";
import { TextInput } from "~/components/inputs";
import { SideDrawer } from "~/components/side-drawer";
import { TransferDrawer } from "~/components/transfer-drawer";
import { TabLink, TabList } from "~/components/tabs";
import { notify } from "~/components/toast";
import { toApiFailure, type ApiFailure } from "~/lib/api/client";
import * as susuApi from "~/lib/api/susu";
import { pickedCustomer } from "~/lib/customer-search.server";
import { formatDate } from "~/lib/format";
import { formatGhs, parseGhsAmount } from "~/lib/money";
import {
  cyclePercent,
  isSusuAccountStatus,
  SUSU_ACCOUNT_STATUS_LABELS,
  SUSU_ACCOUNT_STATUSES,
  SUSU_CYCLE_TARGET,
  SUSU_MIN_DAILY_AMOUNT,
  projectedPayout,
  type SusuAccount,
  type SusuAccountStatus,
} from "~/lib/susu-client";
import type { TransferSourceInfo } from "~/lib/transfer-client";
import { readOpenAccountForm } from "~/lib/susu-form";
import { isOffice, requireUser, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Susu · YADAH Dynamic Enterprise" }];
}

const LIST_ID = "susu-list";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  ...SUSU_ACCOUNT_STATUSES.map((status) => ({
    value: status,
    label: SUSU_ACCOUNT_STATUS_LABELS[status],
  })),
  { value: "all", label: "All" },
];

/** The line under a saver's name — where their cycle stands, in words. */
function cycleBlurb(account: SusuAccount): string {
  if (account.status === "active") {
    const left = Math.max(0, account.cycleTarget - account.depositsCount);
    return left === 0
      ? "Target reached — ready to close."
      : `${left} more deposit${left === 1 ? "" : "s"} to finish the cycle.`;
  }
  if (account.status === "pending-payout") {
    return `${formatGhs(account.payoutRemaining ?? 0)} still to be handed over.`;
  }
  if (account.payoutAmount !== undefined) {
    return `Paid out ${formatGhs(account.payoutAmount)} after commission.`;
  }
  return account.closedAt
    ? `Closed on ${formatDate(account.closedAt)}.`
    : "No longer collecting.";
}

/** Every account one saver holds on this page; `primary` stands for the rest. */
interface SaverGroup {
  key: string;
  primary: SusuAccount;
  rest: SusuAccount[];
}

/**
 * Which account speaks for a saver: a running cycle first, then one with cash
 * still to hand over — that is the one an office needs to act on.
 */
const STATUS_RANK: Record<SusuAccountStatus, number> = {
  active: 0,
  "pending-payout": 1,
  completed: 2,
  closed: 3,
};

function groupBySaver(accounts: SusuAccount[]): SaverGroup[] {
  const buckets = new Map<string, SusuAccount[]>();
  for (const account of accounts) {
    const key = account.customerId || account.id;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(account);
    else buckets.set(key, [account]);
  }

  return Array.from(buckets, ([key, list]) => {
    const sorted = [...list].sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
        b.openedAt.localeCompare(a.openedAt),
    );
    return { key, primary: sorted[0], rest: sorted.slice(1) };
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);

  const url = new URL(request.url);
  const sp = url.searchParams;
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  // Clamped to the API's own bound (1–100); see the note in customers.tsx.
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") || "20") || 20));
  // Fuzzy server-side: a name, a phone, or the first digits of a number.
  const search = sp.get("search")?.trim().slice(0, 100) || undefined;
  // `?open=<id>` arrives from a customer's page — the drawer opens on them.
  const openFor = sp.get("open");

  const statusParam = sp.get("status");
  const selected =
    isSusuAccountStatus(statusParam) || statusParam === "all"
      ? statusParam!
      : "active";
  const status =
    selected === "all" ? undefined : (selected as SusuAccountStatus);

  const { data: payload, headers } = await withAuth(request, async (token) => {
    const [result, prefill] = await Promise.all([
      susuApi.listSusuAccounts(token, { page, limit, status, search }),
      openFor ? pickedCustomer(token, openFor) : null,
    ]);
    return { result, prefill };
  });

  const { result, prefill } = payload;

  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));
  if (page > pageCount) {
    url.searchParams.set("page", String(pageCount));
    throw redirect(url.pathname + url.search, { headers });
  }

  return data(
    {
      result,
      prefill,
      canManage: isOffice(user),
      filters: { page, limit, status: selected, search: search ?? "" },
    },
    { headers },
  );
}

type ActionData = {
  ok?: boolean;
  message?: string;
  formError?: string;
  fieldErrors?: Record<string, string>;
  /** Forwarded so the browser console shows what the API actually said. */
  failure?: ApiFailure;
};

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  if (!isOffice(user)) {
    return data<ActionData>({ formError: "Only office staff can open accounts." });
  }

  const form = await request.formData();
  const customerId = String(form.get("customerId") ?? "").trim();
  const { dailyAmount, fieldErrors } = readOpenAccountForm(form);
  if (!customerId) fieldErrors.customerId = "Pick the customer this is for.";
  if (Object.keys(fieldErrors).length) return data<ActionData>({ fieldErrors });

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      susuApi.openSusuAccount(token, { customerId, dailyAmount }),
    );
    return data<ActionData>(
      {
        ok: true,
        message: `Susu account ${result.account.accountNumber} opened at ${formatGhs(
          result.account.dailyAmount,
        )} a day.`,
      },
      { headers },
    );
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const failure = toApiFailure(error);
    return data<ActionData>({ formError: failure.message, failure });
  }
}

const CELL = "px-4 py-3 align-top";

/**
 * What a cycle can send. One awaiting payout gives only the part still owed;
 * a running one moves whole, which stops it. Null when there is nothing to send.
 */
function susuTransferSource(account: SusuAccount): TransferSourceInfo | null {
  if (account.status === "closed") return null;
  const awaitingPayout = account.status === "pending-payout";
  const amount = awaitingPayout
    ? (account.payoutRemaining ?? 0)
    : projectedPayout(account);
  if (amount <= 0) return null;

  return {
    key: `susu:${account.id}`,
    kind: "susu",
    title: `Susu ${account.accountNumber}`,
    amount,
    partial: awaitingPayout,
  };
}

/** One account line. `saver` fills the first column; nested lines sit under it. */
function AccountRow({
  account,
  saver,
  nested,
  onTransfer,
}: {
  account: SusuAccount;
  saver: ReactNode;
  nested?: boolean;
  /** Omitted for anyone who may not move money; the icon then never appears. */
  onTransfer?: (account: SusuAccount) => void;
}) {
  return (
    <Table.Row
      id={account.id}
      className={nested ? "bg-surface-tertiary/40" : undefined}
    >
      <Table.Cell
        className={`${CELL} font-medium text-foreground ${
          nested ? "border-l-2 border-l-success/50" : ""
        }`}
      >
        {saver}
      </Table.Cell>
      <Table.Cell className={`${CELL} tabular-nums text-muted`}>
        {account.accountNumber}
      </Table.Cell>
      <Table.Cell className={CELL}>
        <SusuStatusPill status={account.status} />
      </Table.Cell>
      <Table.Cell className={`${CELL} tabular-nums text-muted`}>
        {account.depositsCount} of {account.cycleTarget}
        <span className="mt-1.5 block h-1 w-20 overflow-hidden rounded-full bg-border">
          <span
            className="block h-full rounded-full bg-success"
            style={{ width: `${cyclePercent(account)}%` }}
          />
        </span>
      </Table.Cell>
      <Table.Cell className={`${CELL} tabular-nums text-muted`}>
        {formatGhs(account.dailyAmount, { symbol: null })}
      </Table.Cell>
      <Table.Cell className={`${CELL} tabular-nums text-muted`}>
        {formatGhs(account.totalDeposited, { symbol: null })}
      </Table.Cell>
      <Table.Cell className={`${CELL} text-muted`}>
        {formatDate(account.openedAt)}
      </Table.Cell>
      <Table.Cell className={CELL}>
        <div className="flex items-center gap-1">
          <IconLink
            label={`Open account ${account.accountNumber}`}
            to={`/susu/${account.id}`}
          >
            <Eye size={16} />
          </IconLink>
          {onTransfer && susuTransferSource(account) && (
            <IconAction
              label={`Transfer from ${account.accountNumber}`}
              onClick={() => onTransfer(account)}
            >
              <ArrowLeftRight size={16} />
            </IconAction>
          )}
        </div>
      </Table.Cell>
    </Table.Row>
  );
}

/** Opens a cycle for any customer, without leaving the book to find them. */
function OpenSusuDrawer({
  prefill,
  errors,
}: {
  /** Handed over from a customer's own page; opens the drawer on them. */
  prefill: CustomerMatch | null;
  errors?: Record<string, string>;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [open, setOpen] = useState(prefill !== null);
  const [customer, setCustomer] = useState<CustomerMatch | null>(prefill);
  const [amount, setAmount] = useState("");

  const pesewas = parseGhsAmount(amount);
  const valid =
    customer !== null && pesewas !== null && pesewas >= SUSU_MIN_DAILY_AMOUNT;

  // A rejected submit reopens the drawer over whatever the API objected to.
  const [seenErrors, setSeenErrors] = useState(errors);
  if (errors !== seenErrors) {
    setSeenErrors(errors);
    if (errors) setOpen(true);
  }

  // A finished submit leaves the fields ready for the next customer.
  function close() {
    setOpen(false);
    setCustomer(null);
    setAmount("");
  }

  const formId = "open-susu-account";

  return (
    <>
      <Button
        type="button"
        size="sm"
        className="min-h-8 rounded-md bg-success px-3"
        onPress={() => setOpen(true)}
      >
        <Plus size={14} />
        Open an account
      </Button>

      <SideDrawer
        isOpen={open}
        onClose={close}
        title="Open a susu account"
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              className="rounded-md"
              onPress={close}
              isDisabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              className="rounded-md bg-success"
              isDisabled={submitting || !valid}
            >
              {submitting ? "Opening…" : "Open account"}
            </Button>
          </>
        }
      >
        <Form id={formId} method="post" className="space-y-5">
          <div className="space-y-1.5">
            <CustomerPicker
              selected={customer}
              onSelect={setCustomer}
              autoFocus
            />
            <FieldError message={errors?.customerId} />
          </div>

          <div className="space-y-1.5">
            <TextInput
              name="dailyAmount"
              label="Daily amount"
              value={amount}
              onChange={setAmount}
              inputProps={{
                // `decimal` so a phone keypad offers the point for pesewas.
                inputMode: "decimal",
                autoComplete: "off",
                placeholder: "5.00",
                className: FIELD,
              }}
            />
            <FieldError message={errors?.dailyAmount} />
          </div>

          <div className="space-y-3 text-sm text-muted">
            {pesewas !== null && pesewas >= SUSU_MIN_DAILY_AMOUNT ? (
              <p>
                <span className="font-medium text-foreground">
                  {formatGhs(pesewas)}
                </span>{" "}
                every day for {SUSU_CYCLE_TARGET} days —{" "}
                <span className="font-medium text-foreground">
                  {formatGhs(pesewas * SUSU_CYCLE_TARGET)}
                </span>{" "}
                over the full cycle.
              </p>
            ) : (
              pesewas !== null && (
                <p>
                  The smallest daily amount is{" "}
                  <span className="font-medium text-foreground">
                    {formatGhs(SUSU_MIN_DAILY_AMOUNT)}
                  </span>
                  .
                </p>
              )
            )}
            <p>
              The daily amount can't be changed afterwards. To save a different
              amount, this account has to be closed and a new one opened — and
              one day's deposit is kept as commission when it closes.
            </p>
          </div>
        </Form>
      </SideDrawer>
    </>
  );
}

export default function Susu({ loaderData, actionData }: Route.ComponentProps) {
  const { result, prefill, canManage, filters } = loaderData;
  const navigation = useNavigation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(filters.search);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Kept after closing so the drawer can animate out rather than vanish.
  const [transferFor, setTransferFor] = useState<SusuAccount | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  function openTransfer(account: SusuAccount) {
    setTransferFor(account);
    setTransferOpen(true);
  }
  // Bumped on every account opened, to remount the drawer empty and closed.
  const [opened, setOpened] = useState(0);

  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));
  const groups = groupBySaver(result.items);

  function toggleSaver(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  const pendingSearch =
    navigation.state === "loading" && navigation.location
      ? (new URLSearchParams(navigation.location.search).get("search") ?? "")
      : null;
  const searching = pendingSearch !== null && pendingSearch !== filters.search;

  const commitSearch = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set("search", value);
          else next.delete("search");
          next.delete("page");
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setSearchParams],
  );

  // Live search: one request per pause in typing, not per keystroke.
  useEffect(() => {
    if (search === filters.search) return;
    const timer = setTimeout(() => commitSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search, filters.search, commitSearch]);

  // Back/forward moves the URL out from under the field, so adopt it.
  useEffect(() => {
    if (navigationType === "POP") setSearch(filters.search);
  }, [navigationType, filters.search]);

  useEffect(() => {
    if (actionData?.ok) {
      notify.success(actionData.message ?? "Account opened.");
      setOpened((count) => count + 1);
      // The handoff is spent; leaving it would reopen the drawer on reload.
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("open");
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    } else if (actionData?.formError) {
      notify.error(actionData.formError);
    }
    if (actionData?.failure)
      console.error("[susu] request failed:", actionData.failure);
  }, [actionData]);

  // "active" is the loader's default, so it needs no parameter of its own.
  function statusHref(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === "active") next.delete("status");
    else next.set("status", value);
    next.delete("page");
    const qs = next.toString();
    return `/susu${qs ? `?${qs}` : ""}`;
  }

  function setParam(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next);
  }

  return (
    <div className="mx-auto w-full px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Susu
          </h1>
          <p className="mt-1 text-sm text-muted">
            Every susu cycle in the book, with what it takes daily and what it
            has collected.
          </p>
        </div>
        {canManage && (
          <OpenSusuDrawer
            key={opened}
            prefill={prefill}
            errors={actionData?.fieldErrors}
          />
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* A real GET form, so the search still works with JavaScript off. */}
        <Form
          method="get"
          className="w-full max-w-xs"
          onSubmit={(event) => {
            event.preventDefault();
            commitSearch(search);
          }}
        >
          <div className="relative">
            <TextInput
              name="search"
              aria-label="Search susu accounts"
              value={search}
              onChange={setSearch}
              inputProps={{
                placeholder: "Name, phone or account number",
                autoComplete: "off",
                className: `${FIELD} py-1 pl-8`,
              }}
            />
            {searching ? (
              <LoaderCircle
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-2.5 my-auto animate-spin text-success"
              />
            ) : (
              <Search
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-2.5 my-auto text-success"
              />
            )}
          </div>
        </Form>

        <TabList
          label="Filter by status"
          className="max-w-full overflow-x-auto"
        >
          {STATUS_OPTIONS.map((option) => (
            <TabLink
              key={option.value}
              to={statusHref(option.value)}
              selected={option.value === filters.status}
              controls={LIST_ID}
            >
              {option.label}
            </TabLink>
          ))}
        </TabList>
      </div>

      <DataTable
        id={LIST_ID}
        columns={[
          "Saver",
          "Account",
          "Status",
          "Cycle",
          "Daily",
          "Collected",
          "Opened",
          "Actions",
        ]}
        ariaLabel="Susu accounts"
        isLoading={navigation.state === "loading" && !searching}
        page={result.page}
        pageCount={pageCount}
        onPageChange={(p) => setParam({ page: String(p) })}
        pageSize={result.limit}
        onPageSizeChange={(s) => setParam({ limit: String(s), page: "1" })}
        // Contains the loader's default of 20; see the note in customers.tsx.
        pageSizeOptions={[10, 20, 50, 100]}
        summary={
          searching
            ? "Searching…"
            : result.total === 0
              ? "No susu accounts"
              : `Showing ${(result.page - 1) * result.limit + 1}–${Math.min(
                  result.page * result.limit,
                  result.total,
                )} of ${result.total}${
                  groups.length < result.items.length
                    ? ` · ${groups.length} savers`
                    : ""
                }`
        }
        emptyContent={{
          icon: <Coins size={20} />,
          title: "No susu accounts found",
          subtext: filters.search
            ? `Nothing matches “${filters.search}”.`
            : filters.status === "all"
              ? "Open the first one — search for the customer as you go."
              : `No cycles are ${SUSU_ACCOUNT_STATUS_LABELS[
                  filters.status as SusuAccountStatus
                ].toLowerCase()}. Switch the filter to see the rest.`,
        }}
      >
        {groups.flatMap((group) => {
          const open = expanded.has(group.key);
          const rows = [
            <AccountRow
              key={group.primary.id}
              account={group.primary}
              onTransfer={canManage ? openTransfer : undefined}
              saver={
                <>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      to={`/susu/${group.primary.id}`}
                      className="min-w-0 truncate hover:text-success hover:underline"
                    >
                      {group.primary.customerName ?? "Unnamed customer"}
                    </Link>
                    {group.rest.length > 0 && (
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={`${
                          open
                            ? `Hide ${group.rest.length}`
                            : `+${group.rest.length} more`
                        } account${group.rest.length === 1 ? "" : "s"} for ${
                          group.primary.customerName ?? "this saver"
                        }`}
                        onClick={() => toggleSaver(group.key)}
                        className={`flex shrink-0 items-center gap-1 rounded-full border-2 px-2 py-0.5 text-[0.6875rem] font-semibold transition-colors ${
                          open
                            ? "border-success bg-success text-white"
                            : "border-success/40 bg-success/10 text-success hover:bg-success/20"
                        }`}
                      >
                        <ChevronRight
                          size={12}
                          aria-hidden="true"
                          className={`transition-transform ${open ? "rotate-90" : ""}`}
                        />
                        {open
                          ? "Hide"
                          : `+${group.rest.length} more account${group.rest.length === 1 ? "" : "s"}`}
                      </button>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[0.8125rem] font-normal text-navy dark:text-navy-light">
                    {cycleBlurb(group.primary)}
                  </span>
                </>
              }
            />,
          ];

          if (open) {
            for (const account of group.rest) {
              rows.push(
                <AccountRow
                  key={account.id}
                  account={account}
                  nested
                  onTransfer={canManage ? openTransfer : undefined}
                  saver={
                    <span className="flex items-start gap-1.5 pl-5">
                      <CornerDownRight
                        size={13}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-muted"
                      />
                      <Link
                        to={`/susu/${account.id}`}
                        className="min-w-0 text-[0.8125rem] font-normal text-navy hover:text-success hover:underline dark:text-navy-light"
                      >
                        {cycleBlurb(account)}
                      </Link>
                    </span>
                  }
                />,
              );
            }
          }

          return rows;
        })}
      </DataTable>

      {transferFor && susuTransferSource(transferFor) && (
        <TransferDrawer
          isOpen={transferOpen}
          onClose={() => setTransferOpen(false)}
          customerId={transferFor.customerId}
          customerName={transferFor.customerName ?? "This customer"}
          source={susuTransferSource(transferFor)!}
        />
      )}
    </div>
  );
}
