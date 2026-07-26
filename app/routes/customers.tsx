import { useCallback, useEffect, useRef, useState } from "react";
import {
  data,
  Form,
  Link,
  useActionData,
  useNavigation,
  useNavigationType,
  useSearchParams,
} from "react-router";
import { Button, Tooltip } from "@heroui/react";
import {
  Eye,
  PiggyBank,
  Pencil,
  UserPlus,
  Ban,
  RotateCcw,
  Search,
  LoaderCircle,
  EllipsisVertical,
  Filter,
  X,
} from "lucide-react";
import type { Route } from "./+types/customers";
import { DataTable, Table } from "~/components/data-table";
import { ConfirmModal } from "~/components/modals";
import { TextInput } from "~/components/inputs";
import { FIELD, FilterSelect, IconLink } from "~/components/form-fields";
import { notify } from "~/components/toast";
import { ApiError } from "~/lib/api/client";
import * as customersApi from "~/lib/api/customers";
import * as usersApi from "~/lib/api/users";
import {
  ID_TYPE_LABELS,
  type Customer,
  type CustomerStatus,
} from "~/lib/customer-client";
import { isOffice, requireUser, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Customers · YADAH Dynamic Enterprise" }];
}

// Ties the mobile filter toggle to the group it opens (`aria-controls`).
const FILTERS_ID = "customer-filters";

// ---- loader ----------------------------------------------------------------
export async function loader({ request }: Route.LoaderArgs) {
  // Every role may list: the API scopes collectors to their own customers, so
  // there is nothing to guard here beyond being signed in.
  const user = await requireUser(request);
  const url = new URL(request.url);
  const sp = url.searchParams;
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  const limit = Math.max(1, Number(sp.get("limit") || "20") || 20);
  const statusParam = sp.get("status");
  const search = sp.get("search")?.trim() || undefined;
  const status: CustomerStatus =
    statusParam === "inactive" ? "inactive" : "active";
  const assignedCollectorId = sp.get("collector")?.trim() || undefined;
  const office = isOffice(user);

  const { data: result, headers } = await withAuth(request, async (token) => {
    // Both are GETs, so `withAuth` replaying them after a token refresh is safe.
    const [customers, collectors] = await Promise.all([
      customersApi.listCustomers(token, {
        page,
        limit,
        status,
        assignedCollectorId,
        search,
      }),
      // `/users` is admin+manager only — asking as a collector earns a 403 that
      // would sink the whole page. They have no collector filter to populate
      // anyway, since every customer they can see is already theirs.
      //
      // 100 is the API's per-page ceiling. Past that many active collectors
      // this needs paging through, or the filter quietly stops listing people
      // who exist.
      office
        ? usersApi.listUsers(token, {
            role: "collector",
            status: "active",
            limit: 100,
          })
        : null,
    ]);
    return { customers, collectors: collectors?.items ?? [] };
  });

  return data(
    {
      result: result.customers,
      collectors: result.collectors,
      filters: {
        page,
        limit,
        status,
        collector: assignedCollectorId ?? "",
        search: search ?? "",
      },
      canManage: office,
    },
    { headers },
  );
}

// ---- action ----------------------------------------------------------------
/**
 * Only the status switch lives here. Registering happens at `/customers/new`;
 * editing and uploading are on the record itself (`/customers/:id`, with
 * `?edit` for the form) and post to its action — a form that long belongs at a
 * URL you can link to, refresh, and come back to.
 */
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
  const { result, collectors, filters, canManage } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  // The search box types against local state; the URL (and so the loader)
  // catches up on a debounce. Seeded from the URL so a shared/reloaded link
  // shows the term it filtered by.
  const [search, setSearch] = useState(filters.search);
  const activeFilters =
    (filters.collector ? 1 : 0) + (filters.status === "inactive" ? 1 : 0);
  const [filtersOpen, setFiltersOpen] = useState(activeFilters > 0);

  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));

  // Collector id → name, for the table column. Collectors don't get the list
  // (no `/users` access), and don't need it: every row is theirs.
  const collectorNames = new Map(collectors.map((c) => [c.id, c.name]));

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

  // Back/forward moves the URL out from under the field, so adopt it. Our own
  // updates above are REPLACE navigations, which never land here.
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

      {/* Filters. The form stays a real GET form so these still work with
          JavaScript off — every control carries the `name` the loader reads. */}
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
          {/* Collectors have no use for this: the API already narrows their
              list to their own customers, so every option but "all" is empty. */}
          {canManage && (
            <FilterSelect
              name="collector"
              label="Filter by collector"
              value={filters.collector}
              onChange={(value) => setParam({ collector: value, page: null })}
              options={[
                { value: "", label: "All collectors" },
                ...collectors.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          )}

          {/* No "all" for status in the API, so this is a two-way switch rather
              than a filter you clear. Active is the default and stays out of
              the URL — and this is the only route to a deactivated customer. */}
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
        </div>

        <p aria-live="polite" className="sr-only">
          {searching ? "Searching…" : `${result.total} customers found.`}
        </p>
      </Form>

      <DataTable
        columns={
          canManage
            ? ["Name", "Phone", "ID", "Collector", "Actions"]
            : ["Name", "Phone", "ID"]
        }
        ariaLabel="Customer directory"
        isLoading={navigation.state === "loading" && !searching}
        page={result.page}
        pageCount={pageCount}
        onPageChange={(p) => setParam({ page: String(p) })}
        pageSize={result.limit}
        onPageSizeChange={(s) => setParam({ limit: String(s), page: "1" })}
        emptyContent={{
          title: "No customers found",
          subtext: filters.search
            ? `Nothing matches “${filters.search}”. Try a different name, phone or ID.`
            : filters.status === "inactive"
              ? "No inactive customers match these filters."
              : "Try adjusting the filters, or register a customer.",
        }}
      >
        {result.items.map((c) => (
          <Table.Row key={c.id} id={c.id}>
            <Table.Cell className="px-4 py-2 font-medium text-foreground">
              {/* The name is the way in — every role gets the detail page, and
                  for a collector it is the only place they can act. */}
              <Link
                to={`/customers/${c.id}`}
                className="flex items-center gap-2 hover:text-success hover:underline"
              >
                <Avatar customer={c} />
                {c.fullName}
              </Link>
            </Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">{c.phone}</Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">
              {c.identification
                ? `${ID_TYPE_LABELS[c.identification.idType]} · ${c.identification.idNumber}`
                : "—"}
            </Table.Cell>
            {canManage && (
              <>
                <Table.Cell className="px-4 py-2 text-muted">
                  {c.assignedCollectorId
                    ? (collectorNames.get(c.assignedCollectorId) ?? "Unknown")
                    : "Unassigned"}
                </Table.Cell>
                <Table.Cell className="px-4 py-2">
                  <RowActions customer={c} />
                </Table.Cell>
              </>
            )}
          </Table.Row>
        ))}
      </DataTable>
    </div>
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
        className="size-7 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[10px] font-semibold text-brand-dark dark:bg-white/10 dark:text-brand-light"
    >
      {initials}
    </span>
  );
}

function RowActions({ customer }: { customer: Customer }) {
  // Same disclosure as the staff table: icons crowd a phone-width row, so below
  // `sm` they collapse behind a kebab and open on tap.
  const [open, setOpen] = useState(false);
  const actionsId = `actions-${customer.id}`;

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={
          open
            ? `Hide actions for ${customer.fullName}`
            : `Actions for ${customer.fullName}`
        }
        aria-expanded={open}
        aria-controls={actionsId}
        onClick={() => setOpen((prev) => !prev)}
        className="flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground sm:hidden"
      >
        {open ? <X size={16} /> : <EllipsisVertical size={16} />}
      </button>

      <div
        id={actionsId}
        className={`${open ? "flex" : "hidden"} items-center gap-1 sm:flex`}
      >
        <IconLink label="View" to={`/customers/${customer.id}`}>
          <Eye size={16} />
        </IconLink>
        {/* Accounts, not "Susu": the page holds every product the customer
            saves into, and it is where a new cycle is opened each month. */}
        <IconLink label="Accounts" to={`/customers/${customer.id}/accounts`}>
          <PiggyBank size={16} />
        </IconLink>
        <IconLink label="Edit" to={`/customers/${customer.id}?edit`}>
          <Pencil size={16} />
        </IconLink>
        {customer.status === "active" ? (
          <StatusForm
            id={customer.id}
            name={customer.fullName}
            intent="deactivate"
            label="Deactivate"
            danger
          >
            <Ban size={16} />
          </StatusForm>
        ) : (
          <StatusForm
            id={customer.id}
            name={customer.fullName}
            intent="activate"
            label="Activate"
          >
            <RotateCcw size={16} />
          </StatusForm>
        )}
      </div>
    </div>
  );
}

/** Inline POST for activate/deactivate. Deactivating asks first. */
function StatusForm({
  id,
  name,
  intent,
  label,
  danger,
  children,
}: {
  id: string;
  name: string;
  intent: "deactivate" | "activate";
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);
  // Activating is harmless and instantly reversible; deactivating is not.
  const needsConfirm = intent === "deactivate";

  return (
    <>
      <Form method="post" ref={formRef}>
        <input type="hidden" name="id" value={id} />
        {/* The intent rides in a hidden field rather than on the button: a
            confirmed submit goes through `requestSubmit()` with no submitter,
            so a name/value on the button would never reach the action. */}
        <input type="hidden" name="intent" value={intent} />
        {/* Same hover label as the neutral row icons, in the accent this
            action carries. */}
        <Tooltip>
          <Tooltip.Trigger<"button">
            className={[
              "flex size-7 items-center justify-center rounded-lg transition-colors",
              danger
                ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                : "text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40",
            ].join(" ")}
            render={(props) => (
              <button
                {...props}
                type={needsConfirm ? "button" : "submit"}
                onClick={needsConfirm ? () => setConfirming(true) : undefined}
                aria-label={label}
              />
            )}
          >
            {children}
          </Tooltip.Trigger>
          <Tooltip.Content>{label}</Tooltip.Content>
        </Tooltip>
      </Form>

      {needsConfirm && (
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
            <span className="font-medium text-foreground">{name}</span> will be
            marked inactive. Nothing is deleted — their history stays intact and
            you can reactivate them later.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}
