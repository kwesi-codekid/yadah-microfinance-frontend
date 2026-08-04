import { useCallback, useEffect, useState } from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  useNavigationType,
  useSearchParams,
} from "react-router";
import { Button } from "@heroui/react";
import {
  Pencil,
  KeyRound,
  UserPlus,
  Ban,
  RotateCcw,
  Search,
  LoaderCircle,
  EllipsisVertical,
  Filter,
  X,
} from "lucide-react";
import type { Route } from "./+types/staff";
import { DataTable, Table } from "~/components/data-table";
import { TextInput } from "~/components/inputs";
import { FIELD, FilterSelect, IconAction } from "~/components/form-fields";
import {
  RoleBadge,
  StaffDrawer,
  StatusForm,
  type DrawerState,
} from "~/components/staff-forms";
import { notify } from "~/components/toast";
import { ApiError } from "~/lib/api/client";
import * as usersApi from "~/lib/api/users";
import { isRole, ROLES, ROLE_LABELS, type AuthUser } from "~/lib/auth-client";
import { requireUser, withAuth } from "~/lib/session.server";
import {
  runStaffIntent,
  type StaffActionData,
} from "~/lib/staff-intents.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Staff · YADAH Dynamic Enterprise" }];
}

// Ties the mobile filter toggle to the group it opens (`aria-controls`).
const FILTERS_ID = "staff-filters";

// ---- loader ----------------------------------------------------------------
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  // Staff directory is admin + manager only.
  if (user.role !== "admin" && user.role !== "manager") {
    throw redirect("/dashboard");
  }
  const url = new URL(request.url);
  const sp = url.searchParams;
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  const limit = Math.max(1, Number(sp.get("limit") || "20") || 20);
  const roleParam = sp.get("role");
  const statusParam = sp.get("status");
  const search = sp.get("search")?.trim() || undefined;
  const status: "active" | "disabled" =
    statusParam === "disabled" ? "disabled" : "active";
  const role = isRole(roleParam) ? roleParam : undefined;

  const { data: result, headers } = await withAuth(request, (token) =>
    usersApi.listUsers(token, { page, limit, role, status, search }),
  );

  return data(
    {
      result,
      filters: { page, limit, role: role ?? "", status, search: search ?? "" },
      canManage: user.role === "admin",
    },
    { headers },
  );
}

// ---- action ----------------------------------------------------------------
type ActionData = StaffActionData;

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  // Every mutation here is admin-only.
  if (user.role !== "admin") {
    return data<ActionData>({
      formError: "Only administrators can manage staff.",
    });
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      runStaffIntent({ token, intent, id, form }),
    );
    return data<ActionData>(result, { headers });
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

export default function Staff({ loaderData }: Route.ComponentProps) {
  const { result, filters, canManage } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [search, setSearch] = useState(filters.search);
  const activeFilters =
    (filters.role ? 1 : 0) + (filters.status === "disabled" ? 1 : 0);
  const [filtersOpen, setFiltersOpen] = useState(activeFilters > 0);

  const submitting = navigation.state === "submitting";
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

  useEffect(() => {
    if (search === filters.search) return;
    const timer = setTimeout(() => commitSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search, filters.search, commitSearch]);

  useEffect(() => {
    if (navigationType === "POP") setSearch(filters.search);
  }, [navigationType, filters.search]);

  // Close the drawer + toast on a successful mutation.
  useEffect(() => {
    if (actionData?.ok) {
      notify.success(actionData.message ?? "Done.");
      setDrawer(null);
    } else if (actionData?.formError) {
      notify.error(actionData.formError);
    }
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
    <div className="mx-auto w-full  px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Staff  Management</h1>
        </div>
        {canManage && (
          <Button
          size="sm"
            
            className="rounded-md bg-success"
            onPress={() => setDrawer({ mode: "create" })}
          >
            <UserPlus size={12} />
            Add staff
          </Button>
        )}
      </div>

      <Form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setDrawer(null);
          commitSearch(search); // Enter = search now, don't wait out the debounce
        }}
      >
        <div className="flex w-full max-w-xs items-center gap-2">
          <div className="relative flex-1">
            <TextInput
              name="search"
              aria-label="Search staff"
              value={search}
              onChange={setSearch}
              inputProps={{
                placeholder: "Name, username or phone",
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
              activeFilters
                ? `Filters (${activeFilters} applied)`
                : "Filters"
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
            name="role"
            label="Filter by role"
            value={filters.role}
            // A filtered set is a different set — go back to page 1 with it.
            onChange={(value) => setParam({ role: value, page: null })}
            options={[
              { value: "", label: "All roles" },
              ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
            ]}
          />

          <FilterSelect
            name="status"
            label="Filter by status"
            value={filters.status}
            onChange={(value) =>
              setParam({ status: value === "active" ? null : value, page: null })
            }
            options={[
              { value: "active", label: "Active staff" },
              { value: "disabled", label: "Disabled staff" },
            ]}
          />
        </div>

        <p aria-live="polite" className="sr-only">
          {searching ? "Searching…" : `${result.total} staff found.`}
        </p>
      </Form>

      <DataTable
        columns={
          canManage
            ? ["Name", "Username", "Phone", "Role", "Actions"]
            : ["Name", "Username", "Phone", "Role"]
        }
        ariaLabel="Staff directory"
        isLoading={navigation.state === "loading" && !searching}
        page={result.page}
        pageCount={pageCount}
        onPageChange={(p) => setParam({ page: String(p) })}
        pageSize={result.limit}
        onPageSizeChange={(s) => setParam({ limit: String(s), page: "1" })}
        emptyContent={{
          title: "No staff found",
          subtext: filters.search
            ? `Nothing matches “${filters.search}”. Try a different name, username or phone.`
            : filters.status === "disabled"
              ? "No disabled staff match these filters."
              : "Try adjusting the filters, or add a staff member.",
        }}
      >
        {result.items.map((u) => (
          <Table.Row key={u.id} id={u.id}>
            <Table.Cell className="px-4 py-2 font-medium text-foreground">
              <Link
                to={`/staff/${u.id}`}
                className="block truncate hover:text-success hover:underline"
              >
                {u.name}
              </Link>
            </Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">{u.username}</Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">{u.phone}</Table.Cell>
            <Table.Cell className="px-4 py-2">
              <RoleBadge role={u.role} />
            </Table.Cell>
            {canManage && (
              <Table.Cell className="px-4 py-2">
                <RowActions
                  user={u}
                  status={filters.status}
                  onEdit={() => setDrawer({ mode: "edit", user: u })}
                  onReset={() => setDrawer({ mode: "reset", user: u })}
                />
              </Table.Cell>
            )}
          </Table.Row>
        ))}
      </DataTable>

      {/* Create / edit / reset drawer */}
      <StaffDrawer
        state={drawer}
        onClose={() => setDrawer(null)}
        submitting={submitting}
        fieldErrors={actionData?.fieldErrors}
        formError={actionData?.formError}
      />
    </div>
  );
}

function RowActions({
  user,
  status,
  onEdit,
  onReset,
}: {
  user: AuthUser;
  status: "active" | "disabled";
  onEdit: () => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const actionsId = `actions-${user.id}`;

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={open ? `Hide actions for ${user.name}` : `Actions for ${user.name}`}
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
        <IconAction label="Edit" onClick={onEdit}>
          <Pencil size={16} />
        </IconAction>
        <IconAction label="Reset password" onClick={onReset}>
          <KeyRound size={16} />
        </IconAction>
        {status === "active" ? (
          <StatusForm
            id={user.id}
            name={user.name}
            intent="disable"
            label="Disable"
            danger
          >
            <Ban size={16} />
          </StatusForm>
        ) : (
          <StatusForm id={user.id} name={user.name} intent="enable" label="Enable">
            <RotateCcw size={16} />
          </StatusForm>
        )}
      </div>
    </div>
  );
}
