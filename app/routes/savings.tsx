import { useCallback, useEffect, useState } from "react";
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
  Eye,
  Filter,
  LoaderCircle,
  PiggyBank,
  Plus,
  Search,
} from "lucide-react";
import type { Route } from "./+types/savings";
import { SavingsStatusPill } from "~/components/account-status";
import {
  CustomerPicker,
  type CustomerMatch,
} from "~/components/customer-picker";
import { DataTable, Table } from "~/components/data-table";
import {
  FIELD,
  FieldError,
  FilterSelect,
  IconAction,
  IconLink,
} from "~/components/form-fields";
import { TextInput } from "~/components/inputs";
import { SideDrawer } from "~/components/side-drawer";
import { TransferDrawer } from "~/components/transfer-drawer";
import { notify } from "~/components/toast";
import { toApiFailure, type ApiFailure } from "~/lib/api/client";
import * as savingsApi from "~/lib/api/savings";
import { pickedCustomer } from "~/lib/customer-search.server";
import { formatDate } from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import { formatGhs, parseGhsAmount } from "~/lib/money";
import {
  isSavingsAccountStatus,
  SAVINGS_ACCOUNT_STATUS_LABELS,
  SAVINGS_ACCOUNT_STATUSES,
  SAVINGS_FEE,
  SAVINGS_MIN_BALANCE,
  SAVINGS_MIN_DEPOSIT,
  type SavingsAccount,
  type SavingsAccountStatus,
} from "~/lib/savings-client";
import { readOpenSavingsForm } from "~/lib/savings-form";
import { isOffice, requireUser, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Savings · YADAH Dynamic Enterprise" }];
}

const FILTERS_ID = "savings-filters";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All accounts" },
  ...SAVINGS_ACCOUNT_STATUSES.map((status) => ({
    value: status,
    label: SAVINGS_ACCOUNT_STATUS_LABELS[status],
  })),
];

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
  const status: SavingsAccountStatus | undefined = isSavingsAccountStatus(
    statusParam,
  )
    ? statusParam
    : undefined;

  const { data: payload, headers } = await withAuth(request, async (token) => {
    const [result, prefill] = await Promise.all([
      savingsApi.listSavingsAccounts(token, { page, limit, status, search }),
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
      /** Fresh each load, so a resubmit of the same page can't double-open. */
      savingsKey: newIdempotencyKey(),
      filters: {
        page,
        limit,
        status: status ?? "",
        search: search ?? "",
      },
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
  const { initialDeposit, channel, idempotencyKey, fieldErrors } =
    readOpenSavingsForm(form);
  if (!customerId) fieldErrors.customerId = "Pick the customer this is for.";
  if (Object.keys(fieldErrors).length) return data<ActionData>({ fieldErrors });

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      savingsApi.openSavingsAccount(token, {
        customerId,
        ...(initialDeposit !== undefined
          ? { initialDeposit, idempotencyKey, channel }
          : {}),
      }),
    );
    return data<ActionData>(
      {
        ok: true,
        message: result.initialTxn
          ? `Savings account ${result.account.accountNumber} opened with ${formatGhs(result.initialTxn.amount)}.`
          : `Savings account ${result.account.accountNumber} opened.`,
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

/** Opens a savings account for any customer, without leaving the book. */
function OpenSavingsDrawer({
  idempotencyKey,
  prefill,
  errors,
}: {
  idempotencyKey: string;
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
  const belowFloor =
    amount.trim() !== "" && (pesewas === null || pesewas < SAVINGS_MIN_DEPOSIT);

  // A rejected submit reopens the drawer over whatever the API objected to.
  const [seenErrors, setSeenErrors] = useState(errors);
  if (errors !== seenErrors) {
    setSeenErrors(errors);
    if (errors) setOpen(true);
  }

  function close() {
    setOpen(false);
    setCustomer(null);
    setAmount("");
  }

  const formId = "open-savings-account";

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
        title="Open a savings account"
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
              isDisabled={submitting || belowFloor || customer === null}
            >
              {submitting ? "Opening…" : "Open account"}
            </Button>
          </>
        }
      >
        <Form id={formId} method="post" className="space-y-5">
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <input type="hidden" name="channel" value="cash" />

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
              name="initialDeposit"
              label="Opening deposit (optional)"
              value={amount}
              onChange={setAmount}
              inputProps={{
                inputMode: "decimal",
                autoComplete: "off",
                placeholder: "0.00",
                className: FIELD,
              }}
            />
            <FieldError message={errors?.initialDeposit} />
          </div>

          <div className="space-y-3 text-sm text-muted">
            {belowFloor ? (
              <p>
                The smallest deposit is{" "}
                <span className="font-medium text-foreground">
                  {formatGhs(SAVINGS_MIN_DEPOSIT)}
                </span>
                . Leave this blank to open the account empty.
              </p>
            ) : (
              pesewas !== null && (
                <p>
                  Opening with{" "}
                  <span className="font-medium text-foreground">
                    {formatGhs(pesewas)}
                  </span>
                  , recorded as the first deposit.
                </p>
              )
            )}
            <p>
              Money can go in any day. Taking it out costs a flat{" "}
              {formatGhs(SAVINGS_FEE)}, only once a day, and{" "}
              {formatGhs(SAVINGS_MIN_BALANCE)} has to stay in until the account
              is closed.
            </p>
          </div>
        </Form>
      </SideDrawer>
    </>
  );
}

export default function Savings({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { result, prefill, canManage, savingsKey, filters } = loaderData;
  const navigation = useNavigation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(filters.search);
  const activeFilters = filters.status ? 1 : 0;
  const [filtersOpen, setFiltersOpen] = useState(activeFilters > 0);
  // Bumped on every account opened, to remount the drawer empty and closed.
  const [opened, setOpened] = useState(0);
  // Kept after closing so the drawer can animate out rather than vanish.
  const [transferFor, setTransferFor] = useState<SavingsAccount | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));

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
      console.error("[savings] request failed:", actionData.failure);
  }, [actionData]);

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
            Savings
          </h1>
          <p className="mt-1 text-sm text-muted">
            Every savings account in the book, with what is held and what can be
            withdrawn.
          </p>
        </div>
        {canManage && (
          <OpenSavingsDrawer
            key={opened}
            idempotencyKey={savingsKey}
            prefill={prefill}
            errors={actionData?.fieldErrors}
          />
        )}
      </div>

      {/* A real GET form, so the filters still work with JavaScript off. */}
      <Form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          commitSearch(search);
        }}
      >
        <div className="flex w-full max-w-xs items-center gap-2">
          <div className="relative flex-1">
            <TextInput
              name="search"
              aria-label="Search savings accounts"
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

          <button
            type="button"
            aria-label={
              activeFilters ? `Filters (${activeFilters} applied)` : "Filters"
            }
            aria-expanded={filtersOpen}
            aria-controls={FILTERS_ID}
            onClick={() => setFiltersOpen((prev) => !prev)}
            className="relative flex size-9 shrink-0 items-center justify-center rounded-md border-2 border-border bg-field text-muted transition-colors hover:text-foreground sm:hidden"
          >
            <Filter size={16} />
            {activeFilters > 0 && (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 size-2.5 rounded-full bg-success ring-2 ring-surface"
              />
            )}
          </button>
        </div>

        <div
          id={FILTERS_ID}
          className={`${filtersOpen ? "flex" : "hidden"} w-full flex-wrap items-end gap-3 sm:flex sm:w-auto`}
        >
          <FilterSelect
            name="status"
            label="Filter by status"
            value={filters.status}
            onChange={(value) => setParam({ status: value || null, page: null })}
            options={STATUS_OPTIONS}
          />
        </div>
      </Form>

      <DataTable
        columns={[
          "Customer",
          "Account",
          "Balance",
          "Available",
          "Status",
          "Opened",
          "Actions",
        ]}
        ariaLabel="Savings accounts"
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
              ? "No savings accounts"
              : `Showing ${(result.page - 1) * result.limit + 1}–${Math.min(
                  result.page * result.limit,
                  result.total,
                )} of ${result.total}`
        }
        emptyContent={{
          icon: <PiggyBank size={20} />,
          title: "No savings accounts found",
          subtext: filters.search
            ? `Nothing matches “${filters.search}”.`
            : filters.status
              ? `No accounts are ${SAVINGS_ACCOUNT_STATUS_LABELS[
                  filters.status as SavingsAccountStatus
                ].toLowerCase()}.`
              : "Open the first one — search for the customer as you go.",
        }}
      >
        {result.items.map((account) => (
          <Table.Row key={account.id} id={account.id}>
            <Table.Cell className="px-4 py-2 font-medium text-foreground">
              <Link
                to={`/savings/${account.id}`}
                className="block truncate hover:text-success hover:underline"
              >
                {account.customerName ?? "Unnamed customer"}
              </Link>
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {account.accountNumber}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {formatGhs(account.balance, { symbol: null })}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {formatGhs(account.availableToWithdraw, { symbol: null })}
            </Table.Cell>
            <Table.Cell className="px-4 py-2">
              <SavingsStatusPill status={account.status} />
            </Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">
              {formatDate(account.openedAt)}
            </Table.Cell>
            <Table.Cell className="px-4 py-2">
              <div className="flex items-center gap-1">
                <IconLink
                  label={`Open account ${account.accountNumber}`}
                  to={`/savings/${account.id}`}
                >
                  <Eye size={16} />
                </IconLink>
                {canManage && account.status === "active" && (
                  <IconAction
                    label={`Transfer from ${account.accountNumber}`}
                    onClick={() => {
                      setTransferFor(account);
                      setTransferOpen(true);
                    }}
                  >
                    <ArrowLeftRight size={16} />
                  </IconAction>
                )}
              </div>
            </Table.Cell>
          </Table.Row>
        ))}
      </DataTable>

      {transferFor && (
        <TransferDrawer
          isOpen={transferOpen}
          onClose={() => setTransferOpen(false)}
          customerId={transferFor.customerId}
          customerName={transferFor.customerName ?? "This customer"}
          source={{
            key: `savings:${transferFor.id}`,
            kind: "savings",
            title: `Savings ${transferFor.accountNumber}`,
            // The fee and the minimum balance bound it, so a part always moves.
            amount: transferFor.availableToWithdraw,
            partial: true,
          }}
        />
      )}
    </div>
  );
}
