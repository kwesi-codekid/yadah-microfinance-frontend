import { useCallback, useEffect, useRef, useState } from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useNavigate,
  useNavigation,
  useNavigationType,
  useSearchParams,
} from "react-router";
import { Button, Dropdown } from "@heroui/react";
import {
  Eye,
  HandCoins,
  WalletCards,
  Pencil,
  UserPlus,
  Ban,
  RotateCcw,
  Search,
  LoaderCircle,
  EllipsisVertical,
  Filter,
  ShieldCheck,
  CircleAlert,
  TriangleAlert,
} from "lucide-react";
import type { Route } from "./+types/customers";
import { DataTable, Table } from "~/components/data-table";
import { ConfirmModal } from "~/components/modals";
import { TextInput } from "~/components/inputs";
import { FIELD, FilterSelect } from "~/components/form-fields";
import { notify } from "~/components/toast";
import { ApiError } from "~/lib/api/client";
import * as customersApi from "~/lib/api/customers";
import * as loansApi from "~/lib/api/loans";
import { formatDate } from "~/lib/format";
import type { Customer, CustomerStatus } from "~/lib/customer-client";
import type { LoanStatus } from "~/lib/loan-client";
import { formatGhs } from "~/lib/money";
import { isOffice, requireUser, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Customers · YADAH Dynamic Enterprise" }];
}

// Ties the mobile filter toggle to the group it opens (`aria-controls`).
const FILTERS_ID = "customer-filters";

/** The API's page ceiling, and how far the loan/owing sweeps will page. */
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

type Debt = {
  loanId: string;
  /** Pesewas still to pay. Grows on escalation, never shrinks except by paying. */
  remaining: number;
  status: LoanStatus;
};

/** The owing filter's values. Empty is "don't filter". */
type OwingFilter = "" | "yes" | "arrears" | "no";

function isOwingFilter(v: unknown): v is Exclude<OwingFilter, ""> {
  return v === "yes" || v === "arrears" || v === "no";
}

function owingMatches(debt: Debt | undefined, filter: OwingFilter) {
  if (!filter) return true;
  if (filter === "no") return !debt;
  if (filter === "arrears") return debt?.status === "arrears";
  return Boolean(debt);
}

// ---- loader ----------------------------------------------------------------

async function fetchAll<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; total: number }>,
): Promise<{ items: T[]; total: number; truncated: boolean }> {
  const first = await fetchPage(1);
  const pages = Math.min(MAX_PAGES, Math.ceil(first.total / PAGE_SIZE));
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => fetchPage(i + 2)),
  );
  const items = [first.items, ...rest.map((r) => r.items)].flat();
  return { items, total: first.total, truncated: items.length < first.total };
}

async function openLoans(token: string) {
  const [active, arrears] = await Promise.all([
    fetchAll((page) =>
      loansApi.listLoans(token, { page, limit: PAGE_SIZE, status: "active" }),
    ),
    fetchAll((page) =>
      loansApi.listLoans(token, { page, limit: PAGE_SIZE, status: "arrears" }),
    ),
  ]);

  const debts: Record<string, Debt> = {};
  for (const loan of [...active.items, ...arrears.items]) {
    debts[loan.customerId] = {
      loanId: loan.id,
      remaining: loan.remaining,
      status: loan.status,
    };
  }
  return { debts, truncated: active.truncated || arrears.truncated };
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const sp = url.searchParams;
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") || "20") || 20));
  const statusParam = sp.get("status");
  const search = sp.get("search")?.trim() || undefined;
  const status: CustomerStatus =
    statusParam === "inactive" ? "inactive" : "active";
  const office = isOffice(user);

  const owingParam = sp.get("owing");
  const owing: OwingFilter =
    office && isOwingFilter(owingParam) ? owingParam : "";

  const { data: payload, headers } = await withAuth(request, async (token) => {
    const [loans, sweep, onePage] = await Promise.all([
      office ? openLoans(token) : null,
      owing
        ? fetchAll((p) =>
            customersApi.listCustomers(token, {
              page: p,
              limit: PAGE_SIZE,
              status,
              search,
            }),
          )
        : null,
      owing
        ? null
        : customersApi.listCustomers(token, { page, limit, status, search }),
    ]);

    const debts = loans?.debts ?? {};

    let result: customersApi.CustomerListResult;
    if (sweep) {
      const matches = sweep.items.filter((c) => owingMatches(debts[c.id], owing));
      const start = (page - 1) * limit;
      result = {
        items: matches.slice(start, start + limit),
        page,
        limit,
        total: matches.length,
      };
    } else {
      result = onePage!;
    }

    const shown: Record<string, Debt> = {};
    for (const c of result.items) {
      if (debts[c.id]) shown[c.id] = debts[c.id];
    }

    return {
      result,
      debts: shown,
      truncated: (loans?.truncated ?? false) || (sweep?.truncated ?? false),
    };
  });

  const { result, debts, truncated } = payload;

  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));
  if (page > pageCount) {
    url.searchParams.set("page", String(pageCount));
    throw redirect(url.pathname + url.search, { headers });
  }

  return data(
    {
      result,
      debts,
      truncated,
      filters: { page, limit, status, search: search ?? "", owing },
      canManage: office,
    },
    { headers },
  );
}

// ---- action ----------------------------------------------------------------
type ActionData = {
  ok?: boolean;
  intent?: string;
  message?: string;
  formError?: string;
};

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  if (!isOffice(user)) {
    return data<ActionData>({
      formError: "Only office staff can manage customers.",
    });
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");

  try {
    const { data: result, headers } = await withAuth(request, async (token) => {
      if (intent === "deactivate") {
        await customersApi.deactivateCustomer(token, id);
        return {
          ok: true,
          intent,
          message: "Customer deactivated.",
        } satisfies ActionData;
      }
      if (intent === "activate") {
        await customersApi.activateCustomer(token, id);
        return {
          ok: true,
          intent,
          message: "Customer activated.",
        } satisfies ActionData;
      }
      return { formError: "Unsupported action." } satisfies ActionData;
    });
    return data(result, { headers });
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const message =
      error instanceof ApiError
        ? error.message
        : "Something went wrong. Please try again.";
    return data<ActionData>({ intent, formError: message });
  }
}

// ---- component -------------------------------------------------------------
export default function Customers({ loaderData }: Route.ComponentProps) {
  const { result, debts, truncated, filters, canManage } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(filters.search);
  const activeFilters =
    (filters.status === "inactive" ? 1 : 0) + (filters.owing ? 1 : 0);
  const [filtersOpen, setFiltersOpen] = useState(activeFilters > 0);

  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));

  // The term the in-flight navigation is fetching, or null when idle.
  const pendingSearch =
    navigation.state === "loading" && navigation.location
      ? (new URLSearchParams(navigation.location.search).get("search") ?? "")
      : null;
  const searching = pendingSearch !== null && pendingSearch !== filters.search;

  /** Push the term to the URL, which re-runs the loader and refetches. */
  const commitSearch = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set("search", value);
          else next.delete("search");
          // A different term means a different result set — page 1 again.
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

  useEffect(() => {
    if (navigationType === "POP") setSearch(filters.search);
  }, [navigationType, filters.search]);

  useEffect(() => {
    if (actionData?.ok) notify.success(actionData.message ?? "Done.");
    else if (actionData?.formError) notify.error(actionData.formError);
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
            Customers
          </h1>
        </div>
        {canManage && (
          <Link
            to="/customers/new"
            className="flex min-h-8 items-center gap-1.5 rounded-md bg-success px-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <UserPlus size={12} />
            Register customer
          </Link>
        )}
      </div>

      <Form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          commitSearch(search); // Enter = search now, don't wait out the debounce
        }}
      >
        <div className="flex w-full max-w-xs items-center gap-2">
          <div className="relative flex-1">
            <TextInput
              name="search"
              aria-label="Search customers"
              value={search}
              onChange={setSearch}
              inputProps={{
                placeholder: "Name, phone or ID number",
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
            onChange={(value) =>
              setParam({ status: value === "active" ? null : value, page: null })
            }
            options={[
              { value: "active", label: "Active customers" },
              { value: "inactive", label: "Inactive customers" },
            ]}
          />

          {canManage && (
            <FilterSelect
              name="owing"
              label="Filter by what's owed"
              value={filters.owing}
              onChange={(value) => setParam({ owing: value || null, page: null })}
              options={[
                { value: "", label: "All" },
                { value: "yes", label: "Owing" },
                { value: "arrears", label: "In arrears" },
                { value: "no", label: "Owes nothing" },
              ]}
            />
          )}
        </div>

      </Form>

      {truncated && (
        <p className="mb-3 rounded-lg border-2 border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          More records exist than this page reads ({MAX_PAGES * PAGE_SIZE} at
          most), so the Owing column may be short a few. Use the{" "}
          <Link to="/loans" className="font-medium underline">
            loan book
          </Link>{" "}
          for the full picture.
        </p>
      )}

      <DataTable
        columns={[
          "Name",
          "Phone",
          "ID",
          "KYC",
          "Occupation",
          ...(canManage ? ["Owing"] : []),
          "Registered",
          "Actions",
        ]}
        ariaLabel="Customer directory"
        isLoading={navigation.state === "loading" && !searching}
        page={result.page}
        pageCount={pageCount}
        onPageChange={(p) => setParam({ page: String(p) })}
        pageSize={result.limit}
        onPageSizeChange={(s) => setParam({ limit: String(s), page: "1" })}
        pageSizeOptions={[10, 20, 50, 100]}
        summary={
          searching
            ? "Searching…"
            : result.total === 0
              ? "No customers"
              : `Showing ${(result.page - 1) * result.limit + 1}–${Math.min(
                  result.page * result.limit,
                  result.total,
                )} of ${result.total}`
        }
        emptyContent={{
          title: "No customers found",
          subtext: filters.search
            ? `Nothing matches “${filters.search}”. Try a different name, phone or ID.`
            : filters.owing === "arrears"
              ? "Nobody has fallen behind on a loan. Nothing to chase."
              : filters.owing === "yes"
                ? "Nobody has a loan outstanding."
                : filters.owing === "no"
                  ? "Everyone here has something outstanding."
                  : filters.status === "inactive"
                    ? "No inactive customers match these filters."
                    : "Try adjusting the filters, or register a customer.",
        }}
      >
        {result.items.map((c) => (
          <Table.Row key={c.id} id={c.id}>
            <Table.Cell className="px-4 py-2 font-medium text-foreground">
              <Link
                to={`/customers/${c.id}`}
                className="flex items-center gap-2 hover:text-success"
              >
                <Avatar customer={c} />
                <span className="min-w-0">
                  <span className="block truncate hover:underline">
                    {c.fullName}
                  </span>
                  {c.email && (
                    <span
                      className="block truncate text-xs font-normal text-muted"
                      title={c.email}
                    >
                      {c.email}
                    </span>
                  )}
                </span>
              </Link>
            </Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">{c.phone}</Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">
              {c.identification?.idNumber ?? "—"}
            </Table.Cell>
            <Table.Cell className="px-4 py-2">
              <KycChip customer={c} />
            </Table.Cell>
            <Table.Cell className="max-w-40 truncate px-4 py-2 text-muted">
              {c.occupation || "—"}
            </Table.Cell>
            {canManage && (
              <Table.Cell className="whitespace-nowrap px-4 py-2">
                <OwingChip debt={debts[c.id]} />
              </Table.Cell>
            )}
            <Table.Cell className="whitespace-nowrap px-4 py-2 text-muted">
              {formatDate(c.createdAt)}
            </Table.Cell>
            <Table.Cell className="px-4 py-2">
              <RowActions customer={c} canManage={canManage} />
            </Table.Cell>
          </Table.Row>
        ))}
      </DataTable>
    </div>
  );
}

function KycChip({ customer }: { customer: Customer }) {
  const missing: string[] = [];
  if (!customer.identification) missing.push("ID details");
  else if (!customer.idDocumentFrontUrl || !customer.idDocumentBackUrl) {
    missing.push("ID scan");
  }
  if (!customer.photoUrl) missing.push("Photo");

  if (missing.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
        <ShieldCheck size={12} aria-hidden="true" />
        Complete
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger">
      <CircleAlert size={12} aria-hidden="true" />
      {missing.join(" · ")}
    </span>
  );
}

function OwingChip({ debt }: { debt?: Debt }) {
  if (!debt) return <span className="text-sm text-muted">—</span>;

  const arrears = debt.status === "arrears";
  return (
    <Link
      to={`/loans/${debt.loanId}`}
      title={arrears ? "In arrears — open the loan" : "Open the loan"}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums transition-opacity hover:opacity-80 ${
        arrears
          ? "bg-red-500/15 text-red-600 dark:text-red-400"
          : "bg-navy/15 text-navy dark:text-navy-light"
      }`}
    >
      {arrears && <TriangleAlert size={12} aria-hidden="true" />}
      {formatGhs(debt.remaining)}
    </Link>
  );
}

/** Photo thumbnail, falling back to initials when none has been uploaded. */
function Avatar({ customer }: { customer: Customer }) {
  const initials = customer.fullName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (customer.photoUrl) {
    return (
      <img
        src={customer.photoUrl}
        alt=""
        className="size-7 shrink-0 rounded-sm object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-brand/15 text-xs font-semibold text-brand-dark dark:bg-white/10 dark:text-brand-light"
    >
      {initials}
    </span>
  );
}

function RowActions({
  customer,
  canManage,
}: {
  customer: Customer;
  /** Office only: editing the record and switching it on or off. */
  canManage: boolean;
}) {
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);
  const active = customer.status === "active";

  const items: {
    id: string;
    label: string;
    icon: React.ReactNode;
    danger?: boolean;
  }[] = [
    { id: "view", label: "View record", icon: <Eye size={16} /> },
    {
      id: "accounts",
      label: "Accounts",
      icon: <WalletCards size={16} />,
    },
    ...(canManage
      ? [
          { id: "loans", label: "Loans", icon: <HandCoins size={16} /> },
          { id: "edit", label: "Edit details", icon: <Pencil size={16} /> },
          active
            ? {
                id: "deactivate",
                label: "Deactivate",
                icon: <Ban size={16} />,
                danger: true,
              }
            : {
                id: "activate",
                label: "Activate",
                icon: <RotateCcw size={16} />,
              },
        ]
      : []),
  ];

  function run(key: React.Key) {
    switch (key) {
      case "view":
        return navigate(`/customers/${customer.id}`);
      case "accounts":
        return navigate(`/customers/${customer.id}/accounts`);
      case "loans":
        return navigate(`/customers/${customer.id}/loans`);
      case "edit":
        return navigate(`/customers/${customer.id}?edit`);
      // Activating is harmless and instantly reversible; deactivating is not.
      case "activate":
        return formRef.current?.requestSubmit();
      case "deactivate":
        return setConfirming(true);
    }
  }

  return (
    <>
      <Form method="post" ref={formRef} className="hidden">
        <input type="hidden" name="id" value={customer.id} />
        <input
          type="hidden"
          name="intent"
          value={active ? "deactivate" : "activate"}
        />
      </Form>

      <Dropdown>
        <Dropdown.Trigger
          aria-label={`Actions for ${customer.fullName}`}
          className="flex size-8 items-center justify-center rounded-md border-0 bg-transparent text-success shadow-none transition-colors hover:bg-success/10"
        >
          <EllipsisVertical size={16} />
        </Dropdown.Trigger>
        <Dropdown.Popover
          placement="bottom end"
          className="min-w-44 rounded-lg border-2 border-border p-1"
        >
          <Dropdown.Menu
            aria-label={`Actions for ${customer.fullName}`}
            onAction={run}
          >
            {items.map((item) => (
              <Dropdown.Item
                key={item.id}
                id={item.id}
                textValue={item.label}
                className={`flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm ${
                  item.danger ? "text-red-600 dark:text-red-400" : ""
                }`}
              >
                <span aria-hidden="true" className="shrink-0">
                  {item.icon}
                </span>
                {item.label}
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <ConfirmModal
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Deactivate this customer?"
        footer={
          <Button
            size="sm"
            variant="danger"
            className="rounded-md"
            onPress={() => {
              setConfirming(false);
              formRef.current?.requestSubmit();
            }}
          >
            Deactivate
          </Button>
        }
      >
        <p className="text-sm text-muted">
          <span className="font-medium text-foreground">
            {customer.fullName}
          </span>{" "}
          will be marked inactive. Nothing is deleted — their history stays
          intact and you can reactivate them later.
        </p>
      </ConfirmModal>
    </>
  );
}
