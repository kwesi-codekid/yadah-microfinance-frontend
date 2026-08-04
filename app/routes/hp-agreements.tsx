import { useCallback, useEffect, useState } from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useFetcher,
  useNavigation,
  useNavigationType,
  useSearchParams,
} from "react-router";
import { Button } from "@heroui/react";
import {
  Eye,
  FileSignature,
  LoaderCircle,
  Package,
  Search,
} from "lucide-react";
import type { Route } from "./+types/hp-agreements";
import {
  CustomerPicker,
  type CustomerMatch,
} from "~/components/customer-picker";
import { DataTable, Table } from "~/components/data-table";
import { FIELD, FieldError, IconLink } from "~/components/form-fields";
import { HpStatusPill } from "~/components/hp-status";
import { TextInput } from "~/components/inputs";
import { SideDrawer } from "~/components/side-drawer";
import { TabLink, TabList } from "~/components/tabs";
import { notify } from "~/components/toast";
import { toApiFailure, type ApiFailure } from "~/lib/api/client";
import * as hpApi from "~/lib/api/hire-purchase";
import { pickedCustomer } from "~/lib/customer-search.server";
import { formatDate } from "~/lib/format";
import {
  depositFor,
  HP_AGREEMENT_STATUSES,
  HP_AGREEMENT_STATUS_LABELS,
  HP_MAX_MONTHS,
  isHpAgreementStatus,
  readEligibilityReasons,
  type HpAgreementStatus,
  type HpItem,
} from "~/lib/hp-client";
import { formatGhs } from "~/lib/money";
import { requireOffice, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Hire purchase · YADAH Dynamic Enterprise" }];
}

const LIST_ID = "hp-agreements";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All agreements" },
  ...HP_AGREEMENT_STATUSES.map((status) => ({
    value: status,
    label: HP_AGREEMENT_STATUS_LABELS[status],
  })),
];

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);

  const url = new URL(request.url);
  const sp = url.searchParams;
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") || "20") || 20));
  const search = sp.get("search")?.trim().slice(0, 100) || undefined;
  const customerId = sp.get("customerId")?.trim() || undefined;
  const statusParam = sp.get("status");
  const status: HpAgreementStatus | undefined = isHpAgreementStatus(statusParam)
    ? statusParam
    : undefined;
  // `?open=<id>` arrives from elsewhere — the drawer opens on that customer.
  const openFor = sp.get("open");

  const { data: payload, headers } = await withAuth(request, async (token) => {
    const [result, stock, prefill] = await Promise.all([
      hpApi.listHpAgreements(token, { page, limit, status, search, customerId }),
      // Only what can actually be signed for, so the picker can't offer a zero.
      hpApi.listHpItems(token, { status: "active", inStockOnly: true, limit: 100 }),
      openFor ? pickedCustomer(token, openFor) : null,
    ]);
    return { result, stock: stock.items, prefill };
  });

  const { result, stock, prefill } = payload;

  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));
  if (page > pageCount) {
    url.searchParams.set("page", String(pageCount));
    throw redirect(url.pathname + url.search, { headers });
  }

  return data(
    {
      result,
      stock,
      prefill,
      filters: {
        page,
        limit,
        status: status ?? "",
        search: search ?? "",
        customerId: customerId ?? "",
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
  /** Why the API refused, when it refused on eligibility. */
  reasons?: string[];
  /** Forwarded so the browser console shows what the API actually said. */
  failure?: ApiFailure;
};

export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);

  const form = await request.formData();
  const customerId = String(form.get("customerId") ?? "").trim();
  const itemId = String(form.get("itemId") ?? "").trim();
  const months = Number(form.get("durationMonths") ?? "");

  const fieldErrors: Record<string, string> = {};
  if (!customerId) fieldErrors.customerId = "Pick the customer signing.";
  if (!itemId) fieldErrors.itemId = "Pick what they're taking.";
  if (!Number.isInteger(months) || months < 1 || months > HP_MAX_MONTHS)
    fieldErrors.durationMonths = `A whole number of months, 1 to ${HP_MAX_MONTHS}.`;
  if (Object.keys(fieldErrors).length) return data<ActionData>({ fieldErrors });

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      hpApi.signHpAgreement(token, {
        customerId,
        itemId,
        durationMonths: months,
      }),
    );

    return data<ActionData>(
      {
        ok: true,
        message: `Signed for ${result.agreement.item.name}. ${formatGhs(
          result.agreement.depositRequired,
        )} deposit is due before it leaves the shop.`,
      },
      { headers },
    );
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const failure = toApiFailure(error);

    if (failure.code === "NOT_ELIGIBLE") {
      return data<ActionData>({
        formError: "This customer can't sign for hire purchase yet.",
        reasons: readEligibilityReasons(failure.details),
        failure,
      });
    }

    if (failure.code === "OUT_OF_STOCK") {
      return data<ActionData>({
        fieldErrors: {
          itemId: "The last one went while this was open. Pick another.",
        },
        failure,
      });
    }

    return data<ActionData>({
      formError:
        failure.status === 0
          ? "Something went wrong. Please try again."
          : failure.message,
      failure,
    });
  }
}

export default function HpAgreements({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { result, stock, prefill, filters } = loaderData;
  const navigation = useNavigation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(filters.search);
  // Bumped on every agreement signed, to remount the drawer empty.
  const [signed, setSigned] = useState(0);

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
      notify.success(actionData.message ?? "Agreement signed.");
      setSigned((count) => count + 1);
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
      console.error("[hire-purchase] request failed:", actionData.failure);
  }, [actionData, setSearchParams]);

  function statusHref(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("status", value);
    else next.delete("status");
    next.delete("page");
    const qs = next.toString();
    return `/hire-purchase${qs ? `?${qs}` : ""}`;
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
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Hire purchase
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Every agreement in the book. Half the price is due as a deposit
            before the item is released; the rest is paid monthly.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SignDrawer
            key={signed}
            stock={stock}
            prefill={prefill}
            fieldErrors={actionData?.fieldErrors}
            formError={actionData?.formError}
            reasons={actionData?.reasons}
          />
          <Link
            to="/hire-purchase/items"
            className="flex min-h-8 items-center gap-1.5 rounded-md border-2 border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-secondary"
          >
            <Package size={12} />
            Inventory
          </Link>
        </div>
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
              aria-label="Search agreements"
              value={search}
              onChange={setSearch}
              inputProps={{
                placeholder: "Customer or item",
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

        <TabList label="Filter by status" className="max-w-full overflow-x-auto">
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

      {filters.customerId && (
        <button
          type="button"
          onClick={() => setParam({ customerId: null, page: null })}
          className="mb-3 flex min-h-8 items-center gap-1.5 rounded-full border-2 border-border px-3 text-xs font-medium text-muted transition-colors hover:text-foreground"
        >
          One customer only · clear
        </button>
      )}

      <DataTable
        id={LIST_ID}
        columns={[
          "Customer",
          "Item",
          "Deposit",
          "Term",
          "Status",
          "Paid",
          "Signed",
          "Actions",
        ]}
        ariaLabel="Hire purchase agreements"
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
              ? "No agreements"
              : `Showing ${(result.page - 1) * result.limit + 1}–${Math.min(
                  result.page * result.limit,
                  result.total,
                )} of ${result.total}`
        }
        emptyContent={{
          icon: <FileSignature size={20} />,
          title: "No agreements found",
          subtext: filters.search
            ? `Nothing matches “${filters.search}”.`
            : filters.status
              ? `Nothing is ${HP_AGREEMENT_STATUS_LABELS[
                  filters.status as HpAgreementStatus
                ].toLowerCase()}.`
              : "Sign the first one — the customer needs three months of saving behind them.",
        }}
      >
        {result.items.map((agreement) => (
          <Table.Row key={agreement.id} id={agreement.id}>
            <Table.Cell className="px-4 py-2 font-medium text-foreground">
              <Link
                to={`/hire-purchase/${agreement.id}`}
                className="block truncate hover:text-success hover:underline"
              >
                {agreement.customerName ?? "Unnamed customer"}
              </Link>
            </Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">
              <span className="block truncate">{agreement.item.name}</span>
              <span className="block truncate text-xs">
                {formatGhs(agreement.item.sellingPrice, { symbol: null })}
              </span>
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {formatGhs(agreement.depositRequired, { symbol: null })}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">
              {agreement.durationMonths} mo · {agreement.interestRatePercent}%
            </Table.Cell>
            <Table.Cell className="px-4 py-2">
              <HpStatusPill agreement={agreement} />
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {formatGhs(agreement.totalPaid, { symbol: null })}
              <span className="block text-xs">
                {formatGhs(agreement.remaining, { symbol: null })} left
              </span>
            </Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">
              {formatDate(agreement.createdAt)}
            </Table.Cell>
            <Table.Cell className="px-4 py-2">
              <IconLink
                label={`Open ${agreement.customerName ?? "this"} agreement`}
                to={`/hire-purchase/${agreement.id}`}
              >
                <Eye size={16} />
              </IconLink>
            </Table.Cell>
          </Table.Row>
        ))}
      </DataTable>
    </div>
  );
}

/** Signs one agreement: who, what, and over how long. */
function SignDrawer({
  stock,
  prefill,
  fieldErrors,
  formError,
  reasons,
}: {
  stock: HpItem[];
  prefill: CustomerMatch | null;
  fieldErrors?: Record<string, string>;
  formError?: string;
  reasons?: string[];
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [open, setOpen] = useState(prefill !== null);
  const [customer, setCustomer] = useState<CustomerMatch | null>(prefill);
  const [itemId, setItemId] = useState("");
  const [months, setMonths] = useState("6");

  // Whether they may sign at all is per customer — so ask on pick.
  const gate = useFetcher<{
    eligible: boolean | null;
    reasons: string[];
    error: string | null;
  }>();
  useEffect(() => {
    if (customer) gate.load(`/hire-purchase/eligibility?customerId=${customer.id}`);
    // `gate` is stable enough to leave out; including it re-runs the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer]);

  // A rejected submit reopens the drawer over whatever the API objected to.
  const [seenError, setSeenError] = useState(fieldErrors ?? formError);
  const latestError = fieldErrors ?? formError;
  if (latestError !== seenError) {
    setSeenError(latestError);
    if (latestError) setOpen(true);
  }

  function close() {
    setOpen(false);
    setCustomer(null);
    setItemId("");
    setMonths("6");
  }

  const item = stock.find((candidate) => candidate.id === itemId) ?? null;
  const term = Number(months);
  const checking = customer !== null && gate.state === "loading";
  const blocked = gate.data?.eligible === false;
  const ready =
    customer !== null &&
    item !== null &&
    !blocked &&
    Number.isInteger(term) &&
    term >= 1 &&
    term <= HP_MAX_MONTHS;

  const deposit = item ? depositFor(item.sellingPrice) : 0;
  const financed = item ? item.sellingPrice - deposit : 0;

  return (
    <>
      <Button
        type="button"
        size="sm"
        className="min-h-8 rounded-md bg-success px-3"
        onPress={() => setOpen(true)}
      >
        <FileSignature size={14} />
        Sign an agreement
      </Button>

      <SideDrawer
        isOpen={open}
        onClose={close}
        title="Sign a hire purchase"
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
              form="hp-sign"
              className="rounded-md bg-success"
              isDisabled={submitting || !ready}
            >
              {submitting ? "Signing…" : "Sign"}
            </Button>
          </>
        }
      >
        <Form id="hp-sign" method="post" className="space-y-5">
          <div className="space-y-1.5">
            <CustomerPicker
              selected={customer}
              onSelect={setCustomer}
              autoFocus
            />
            <FieldError message={fieldErrors?.customerId} />
          </div>

          {checking && (
            <p className="flex items-center gap-2 text-xs text-muted">
              <LoaderCircle size={13} className="animate-spin text-success" />
              Checking whether they can sign…
            </p>
          )}

          {gate.data?.error && (
            <p className="rounded-lg border-2 border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
              {gate.data.error}
            </p>
          )}

          {(blocked || (reasons?.length ?? 0) > 0) && (
            <div className="rounded-lg border-2 border-warning/40 bg-warning/10 px-3 py-2">
              <p className="text-sm font-medium text-foreground">
                They can't sign yet
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted">
                {(reasons?.length ? reasons : (gate.data?.reasons ?? [])).map(
                  (reason) => (
                    <li key={reason}>· {reason}</li>
                  ),
                )}
              </ul>
              <p className="mt-1 text-xs text-muted">
                Hire purchase needs an active susu or savings account, three
                months of history, no live loan and no open agreement.
              </p>
            </div>
          )}

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-foreground">Item</legend>
            <input type="hidden" name="itemId" value={itemId} />
            {stock.length === 0 ? (
              <p className="rounded-lg border-2 border-dashed border-border p-4 text-center text-sm text-muted">
                Nothing is in stock.{" "}
                <Link
                  to="/hire-purchase/items"
                  className="font-medium text-success hover:underline"
                >
                  Add an item
                </Link>
              </p>
            ) : (
              <ul className="max-h-64 space-y-2 overflow-y-auto">
                {stock.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      aria-pressed={itemId === candidate.id}
                      onClick={() => setItemId(candidate.id)}
                      className={`w-full rounded-lg border-2 p-3 text-left transition-colors ${
                        itemId === candidate.id
                          ? "border-success"
                          : "border-border hover:border-success/50"
                      }`}
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-medium text-foreground">
                          {candidate.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-foreground">
                          {formatGhs(candidate.sellingPrice)}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {candidate.quantityInStock} in stock · deposit{" "}
                        {formatGhs(depositFor(candidate.sellingPrice))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <FieldError message={fieldErrors?.itemId} />
          </fieldset>

          <div className="space-y-1.5">
            <TextInput
              name="durationMonths"
              label="Term in months"
              value={months}
              onChange={setMonths}
              inputProps={{
                inputMode: "numeric",
                autoComplete: "off",
                className: FIELD,
              }}
            />
            <FieldError message={fieldErrors?.durationMonths} />
            <p className="text-xs text-muted">1 to {HP_MAX_MONTHS} months.</p>
          </div>

          {item && (
            <dl className="space-y-2 rounded-lg border-2 border-border bg-background p-3">
              <Figure label="Price" value={formatGhs(item.sellingPrice)} />
              <Figure label="Deposit due now" value={formatGhs(deposit)} strong />
              <Figure label="Financed" value={formatGhs(financed)} />
            </dl>
          )}

          <p className="text-xs text-muted">
            Signing takes the item out of stock and copies its price onto the
            agreement. Nothing is released until the deposit is paid, and
            rejecting a pending agreement puts the item back.
          </p>
        </Form>
      </SideDrawer>
    </>
  );
}

/** One label/figure pair. `strong` marks the number the eye should land on. */
function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd
        className={`shrink-0 tabular-nums ${
          strong
            ? "text-base font-semibold text-foreground"
            : "text-sm text-foreground"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
