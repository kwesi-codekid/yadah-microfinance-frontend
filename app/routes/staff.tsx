import { useCallback, useEffect, useRef, useState } from "react";
import {
  data,
  Form,
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
import { ConfirmModal } from "~/components/modals";
import { SideDrawer } from "~/components/side-drawer";
import { TextInput } from "~/components/inputs";
import {
  Field,
  FIELD,
  FilterSelect,
  IconAction,
  SelectField,
} from "~/components/form-fields";
import { notify } from "~/components/toast";
import { ApiError } from "~/lib/api/client";
import * as usersApi from "~/lib/api/users";
import { ROLES, ROLE_LABELS, type AuthUser, type Role } from "~/lib/auth-client";
import { requireUser, withAuth } from "~/lib/session.server";
import {
  validatePhone,
  validateUsername,
} from "~/lib/validation";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Staff · YADAH Dynamic Enterprise" }];
}

// Ties the mobile filter toggle to the group it opens (`aria-controls`).
const FILTERS_ID = "staff-filters";

function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as string[]).includes(v);
}

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

  // `headers` may carry a refreshed session cookie — it has to ride along on
  // the response or the rotated refresh token is lost.
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
type ActionData = {
  ok?: boolean;
  intent?: string;
  message?: string;
  formError?: string;
  fieldErrors?: Record<string, string>;
};

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
    // `withAuth` may run this twice — once on an expired token, once on a
    // fresh one. Safe here: a 401 means the API refused the call outright, so
    // nothing was written. Its `headers` carry the renewed session cookie.
    const { data: result, headers } = await withAuth(request, (token) =>
      runIntent({ token, intent, id, form }),
    );
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

/** Validate and perform one staff mutation. Throws `ApiError` on rejection. */
async function runIntent({
  token,
  intent,
  id,
  form,
}: {
  token: string;
  intent: string;
  id: string;
  form: FormData;
}): Promise<ActionData> {
  if (intent === "create") {
    const input = {
      name: String(form.get("name") ?? "").trim(),
      username: String(form.get("username") ?? "").trim(),
      phone: String(form.get("phone") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      role: String(form.get("role") ?? ""),
      password: String(form.get("password") ?? ""),
    };
    const fieldErrors: Record<string, string> = {};
    if (input.name.length < 2 || input.name.length > 100)
      fieldErrors.name = "Name must be 2–100 characters.";
    const u = validateUsername(input.username);
    if (u) fieldErrors.username = u;
    const p = validatePhone(input.phone);
    if (p) fieldErrors.phone = p;
    if (!isRole(input.role)) fieldErrors.role = "Choose a role.";
    if (input.password.length < 8 || input.password.length > 128)
      fieldErrors.password = "Password must be 8–128 characters.";
    if (Object.keys(fieldErrors).length)
      return { intent, fieldErrors } satisfies ActionData;

    await usersApi.createUser(token, {
      name: input.name,
      username: input.username,
      phone: input.phone,
      email: input.email || undefined,
      role: input.role as Role,
      password: input.password,
    });
    return { ok: true, intent, message: `${input.name} added.` } satisfies ActionData;
  }

  if (intent === "update") {
    const name = String(form.get("name") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const role = String(form.get("role") ?? "");
    const fieldErrors: Record<string, string> = {};
    if (name.length < 2 || name.length > 100)
      fieldErrors.name = "Name must be 2–100 characters.";
    const p = validatePhone(phone);
    if (p) fieldErrors.phone = p;
    if (!isRole(role)) fieldErrors.role = "Choose a role.";
    if (Object.keys(fieldErrors).length)
      return { intent, fieldErrors } satisfies ActionData;

    await usersApi.updateUser(token, id, {
      name,
      phone,
      email: email || undefined,
      role: role as Role,
    });
    return { ok: true, intent, message: "Staff updated." } satisfies ActionData;
  }

  if (intent === "reset-password") {
    const newPassword = String(form.get("newPassword") ?? "");
    const mustChangePassword = form.get("mustChangePassword") === "on";
    if (newPassword.length < 8 || newPassword.length > 128)
      return {
        intent,
        fieldErrors: { newPassword: "Password must be 8–128 characters." },
      } satisfies ActionData;
    await usersApi.resetUserPassword(token, id, { newPassword, mustChangePassword });
    return { ok: true, intent, message: "Password reset." } satisfies ActionData;
  }

  if (intent === "disable") {
    await usersApi.disableUser(token, id);
    return { ok: true, intent, message: "Staff disabled." } satisfies ActionData;
  }

  if (intent === "enable") {
    await usersApi.enableUser(token, id);
    return { ok: true, intent, message: "Staff enabled." } satisfies ActionData;
  }

  return { formError: "Unsupported action." } satisfies ActionData;
}

// ---- component -------------------------------------------------------------
type DrawerState =
  | { mode: "create" }
  | { mode: "edit"; user: AuthUser }
  | { mode: "reset"; user: AuthUser }
  | null;

export default function Staff({ loaderData }: Route.ComponentProps) {
  const { result, filters, canManage } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const [drawer, setDrawer] = useState<DrawerState>(null);
  // The search box types against local state; the URL (and so the loader)
  // catches up on a debounce. Seeded from the URL so a shared/reloaded link
  // shows the term it filtered by.
  const [search, setSearch] = useState(filters.search);
  // Anything that isn't the default view. Drives the toggle's dot, and opens
  // the group on load when a link arrives already filtered — otherwise the
  // narrowed table on a phone has no visible explanation.
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
        // `replace` keeps the back button pointing at wherever the user came
        // from rather than at every term they typed through on the way here.
        { replace: true, preventScrollReset: true },
      );
    },
    [setSearchParams],
  );

  // Live search: one request per pause in typing, not per keystroke. The guard
  // also covers the round trip — once the loader answers, `filters.search`
  // matches and this settles instead of re-firing.
  useEffect(() => {
    if (search === filters.search) return;
    const timer = setTimeout(() => commitSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search, filters.search, commitSearch]);

  // Back/forward moves the URL out from under the field, so adopt it. Our own
  // updates above are REPLACE navigations, which never land here — a slow
  // response therefore can't overwrite what is being typed.
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

      {/* Filters. The form stays a real GET form so these still work with
          JavaScript off — every control carries the `name` the loader reads, so
          a native submit sends the whole bar. With JS on, `onSubmit` hands over
          to the live search and the selects apply on change. */}
      <Form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setDrawer(null);
          commitSearch(search); // Enter = search now, don't wait out the debounce
        }}
      >
        {/* The icon is positioned over the field, so the input carries `pl-8`
            to keep typed text clear of it. `aria-label` stands in for the
            visible label this field no longer has.

            `py-1` is what actually shortens it: HeroUI's `.input` ships `py-2`,
            which with a 20px line and the 2px borders renders ~40px however
            low `min-h` goes. */}
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

          {/* Mobile only: search is the common case and keeps the bar, the two
              selects fold behind this. Styled off the fields so it reads as
              their peer rather than as an action. */}
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
            {/* Collapsed filters are still applied — say so, or a narrowed list
                looks like missing data. */}
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

          {/* The API has no "all" for status, so this is a two-way switch rather
              than a filter you clear. Active is the default, so it stays out of
              the URL. Disabled staff are only reachable through here — and this
              is the only route to the Enable action on their rows. */}
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

        {/* Results change without the user submitting anything, so announce the
            count for screen readers. */}
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
        // Skeletons for page / page-size changes, but not while typing — the
        // table flashing on every keystroke reads worse than rows that lag a
        // moment behind. The spinner in the field carries that state instead.
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
              {u.name}
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
  // Three icons per row crowd a phone-width table, so below `sm` they collapse
  // behind a kebab and open on tap. From `sm` up they are always inline and the
  // toggle is gone, so this state simply never applies there.
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
        // Bigger than the actions it reveals: it is the one control a thumb has
        // to find on a phone. Back to the row size once it hides at `sm`.
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


/** Inline POST for enable/disable. Disabling asks for confirmation first. */
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
  intent: "disable" | "enable";
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);
  // Enabling is harmless and instantly reversible; disabling locks someone out.
  const needsConfirm = intent === "disable";

  return (
    <>
      <Form method="post" ref={formRef}>
        <input type="hidden" name="id" value={id} />
        {/* The intent rides in a hidden field rather than on the button: a
            confirmed submit goes through `requestSubmit()` with no submitter,
            so a name/value on the button would never reach the action. */}
        <input type="hidden" name="intent" value={intent} />
        <button
          type={needsConfirm ? "button" : "submit"}
          onClick={needsConfirm ? () => setConfirming(true) : undefined}
          title={label}
          aria-label={label}
          className={[
            "flex size-7 items-center justify-center rounded-lg transition-colors",
            danger
              ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              : "text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40",
          ].join(" ")}
        >
          {children}
        </button>
      </Form>

      {needsConfirm && (
        <ConfirmModal
          isOpen={confirming}
          onOpenChange={setConfirming}
          title="Disable this staff member?"
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
              Disable
            </Button>
          }
        >
          <p className="text-sm text-muted">
            <span className="font-medium text-foreground">{name}</span> will no
            longer be able to sign in. You can enable them again later.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <span className="inline-flex items-center rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium text-foreground dark:bg-white/10">
      {ROLE_LABELS[role]}
    </span>
  );
}

function StaffDrawer({
  state,
  onClose,
  submitting,
  fieldErrors,
  formError,
}: {
  state: DrawerState;
  onClose: () => void;
  submitting: boolean;
  fieldErrors?: Record<string, string>;
  formError?: string;
}) {
  const mode = state?.mode ?? "create";
  const user = state && "user" in state ? state.user : undefined;
  const title =
    mode === "create"
      ? "Add staff"
      : mode === "edit"
        ? "Edit staff"
        : "Reset password";
  const intent =
    mode === "create" ? "create" : mode === "edit" ? "update" : "reset-password";
  const submitLabel =
    mode === "create" ? "Create" : mode === "edit" ? "Save changes" : "Reset password";
  // Doubles as the form's `key`, so switching target remounts it (and resets
  // every defaultValue), and as the `id` the footer's submit button points at.
  const formId = `staff-${mode}-${user?.id ?? "new"}`;

  return (
    <SideDrawer
      isOpen={state !== null}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            className="rounded-md"
            onPress={onClose}
            isDisabled={submitting}
          >
            Cancel
          </Button>
          {/* Lives outside the <form>, so `form` ties it back to one. */}
          <Button
            type="submit"
            form={formId}
            className="rounded-md bg-success"
            isDisabled={submitting}
          >
            {submitting ? "Saving…" : submitLabel}
          </Button>
        </>
      }
    >
      <Form id={formId} key={formId} method="post" className="space-y-5">
        <input type="hidden" name="intent" value={intent} />
        {user && <input type="hidden" name="id" value={user.id} />}

        {formError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {formError}
          </p>
        )}

        {mode !== "reset" && (
          <>
            <Field
              name="name"
              label="Full name"
              defaultValue={user?.name}
              error={fieldErrors?.name}
              inputProps={{ autoComplete: "name" }}
            />
            {mode === "create" && (
              <Field
                name="username"
                label="Username"
                error={fieldErrors?.username}
                inputProps={{ autoCapitalize: "none", autoComplete: "off" }}
              />
            )}
            <Field
              name="phone"
              label="Phone"
              defaultValue={user?.phone}
              error={fieldErrors?.phone}
              inputProps={{ inputMode: "numeric", placeholder: "0241234567" }}
            />
            <Field
              name="email"
              label="Email (optional)"
              type="email"
              defaultValue={user?.email}
              error={fieldErrors?.email}
              inputProps={{ autoComplete: "off" }}
            />
            <SelectField
              name="role"
              label="Role"
              defaultValue={user?.role ?? ""}
              placeholder="Select a role"
              error={fieldErrors?.role}
              options={ROLES.map((r) => ({
                value: r,
                label: ROLE_LABELS[r],
              }))}
            />
            {mode === "create" && (
              <Field
                name="password"
                label="Temporary password"
                type="password"
                error={fieldErrors?.password}
                inputProps={{ autoComplete: "new-password" }}
              />
            )}
          </>
        )}

        {mode === "reset" && (
          <>
            <p className="text-sm text-muted">
              Set a new password for <span className="font-medium text-foreground">{user?.name}</span>.
            </p>
            <Field
              name="newPassword"
              label="New password"
              type="password"
              error={fieldErrors?.newPassword}
              inputProps={{ autoComplete: "new-password" }}
            />
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                name="mustChangePassword"
                defaultChecked
                className="size-4 rounded border-border accent-accent"
              />
              Require a password change at next sign-in
            </label>
          </>
        )}

      </Form>
    </SideDrawer>
  );
}