import { useCallback, useEffect, useRef, useState } from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useFetcher,
  useNavigation,
  useNavigationType,
  useSearchParams,
  useSubmit,
} from "react-router";
import { Button } from "@heroui/react";
import {
  Eye,
  HandCoins,
  LoaderCircle,
  Search,
  Settings2,
} from "lucide-react";
import type { Route } from "./+types/loans";
import {
  CustomerPicker,
  type CustomerMatch,
} from "~/components/customer-picker";
import { DataTable, Table } from "~/components/data-table";
import { TextInput } from "~/components/inputs";
import { FIELD, FieldError, IconLink } from "~/components/form-fields";
import { LoanStatusPill } from "~/components/loan-status";
import { ConfirmModal } from "~/components/modals";
import { SideDrawer } from "~/components/side-drawer";
import { TabLink, TabList } from "~/components/tabs";
import { notify } from "~/components/toast";
import { toApiFailure, type ApiFailure } from "~/lib/api/client";
import * as loansApi from "~/lib/api/loans";
import { pickedCustomer } from "~/lib/customer-search.server";
import { formatDate } from "~/lib/format";
import {
  isLoanStatus,
  LOAN_APPLICATION_ERRORS,
  LOAN_DURATIONS,
  LOAN_STATUS_LABELS,
  LOAN_TIER_LABELS,
  normalizeLoanConfig,
  projectInstalments,
  projectInterest,
  projectTotalDue,
  rateFor,
  repaidPercent,
  tierFor,
  type LoanConfig,
  type LoanDuration,
  type LoanEligibility,
  type LoanStatus,
} from "~/lib/loan-client";
import { readLoanApplicationForm } from "~/lib/loan-form";
import { formatGhs, parseGhsAmount } from "~/lib/money";
import { requireOffice, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Loans · YADAH Dynamic Enterprise" }];
}

const LIST_ID = "loan-list";

/**
 * Statuses in the order the office works them: the live book first, then the
 * queue and the trouble, with the finished ones and "all" behind those.
 */
const TAB_ORDER: LoanStatus[] = [
  "active",
  "arrears",
  "pending",
  "repaid",
  "rejected",
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  ...TAB_ORDER.map((status) => ({
    value: status,
    label: LOAN_STATUS_LABELS[status],
  })),
  { value: "", label: "All loans" },
];

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);

  const url = new URL(request.url);
  const sp = url.searchParams;
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  // Clamped to the API's own bound (1–100); see the note in customers.tsx.
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") || "20") || 20));
  const search = sp.get("search")?.trim() || undefined;
  const customerId = sp.get("customerId")?.trim() || undefined;
  const statusParam = sp.get("status");
  const status: LoanStatus | undefined = isLoanStatus(statusParam)
    ? statusParam
    : undefined;

  // `?open=<id>` arrives from elsewhere — the drawer opens on that customer.
  const openFor = sp.get("open");

  const { data: payload, headers } = await withAuth(request, async (token) => {
    const [result, rawConfig, prefill] = await Promise.all([
      loansApi.listLoans(token, { page, limit, status, search, customerId }),
      loansApi.getLoanConfig(token),
      openFor ? pickedCustomer(token, openFor) : null,
    ]);
    return { result, rawConfig, prefill };
  });

  const { result, rawConfig, prefill } = payload;
  const { config, complete } = normalizeLoanConfig(
    (rawConfig as { config?: unknown }).config,
  );

  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));
  if (page > pageCount) {
    url.searchParams.set("page", String(pageCount));
    throw redirect(url.pathname + url.search, { headers });
  }

  return data(
    {
      result,
      config,
      /** False when the config response was missing fields and defaults filled in. */
      configComplete: complete,
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
  /** Forwarded so the browser console shows what the API actually said. */
  failure?: ApiFailure;
};

export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const customerId = String(form.get("customerId") ?? "").trim();

  try {
    const { data: result, headers } = await withAuth(request, async (token) => {
      // Read the config here too: the browser's copy is only a hint.
      const raw = await loansApi.getLoanConfig(token);
      const { config } = normalizeLoanConfig(
        (raw as { config?: unknown }).config,
      );

      const { principal, durationMonths, fieldErrors } =
        readLoanApplicationForm(form, config);
      if (!customerId)
        fieldErrors.customerId = "Pick the customer this is for.";
      if (Object.keys(fieldErrors).length) {
        return { fieldErrors } satisfies ActionData;
      }

      const { loan } = await loansApi.applyForLoan(token, {
        customerId,
        principal,
        durationMonths,
      });
      return { principal: loan?.principal ?? principal };
    });

    if ("fieldErrors" in result) return data<ActionData>(result, { headers });

    return data<ActionData>(
      {
        ok: true,
        message: `Application for ${formatGhs(result.principal)} recorded — pending approval.`,
      },
      { headers },
    );
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const failure = toApiFailure(error);
    const known = LOAN_APPLICATION_ERRORS[failure.code];

    if (
      failure.code === "PRINCIPAL_OUT_OF_RANGE" ||
      failure.code === "BIG_TIER_LOCKED"
    ) {
      return data<ActionData>({
        fieldErrors: { principal: known ?? failure.message },
        failure,
      });
    }

    return data<ActionData>({
      formError:
        known ??
        (failure.status === 0
          ? "Something went wrong. Please try again."
          : failure.message),
      failure,
    });
  }
}

/** Why this customer can't borrow right now, in the office's words. */
function applicationBlocker(
  eligibility: LoanEligibility,
): { title: string; detail: string } | null {
  if (!eligibility.customer.hasGhanaCard) {
    return {
      title: "No Ghana Card on file",
      detail: LOAN_APPLICATION_ERRORS.GHANA_CARD_REQUIRED,
    };
  }
  if (eligibility.openLoan) {
    return {
      title: "This customer already has an open loan",
      detail: LOAN_APPLICATION_ERRORS.LOAN_EXISTS,
    };
  }
  return null;
}

/** Records an application for any customer, without leaving the loan book. */
function ApplyDrawer({
  config,
  configComplete,
  prefill,
  fieldErrors,
  formError,
}: {
  config: LoanConfig;
  configComplete: boolean;
  /** Handed over in `?open=`; opens the drawer on that customer. */
  prefill: CustomerMatch | null;
  fieldErrors?: Record<string, string>;
  formError?: string;
}) {
  const navigation = useNavigation();
  const submit = useSubmit();
  const submitting = navigation.state === "submitting";
  const [open, setOpen] = useState(prefill !== null);
  const [customer, setCustomer] = useState<CustomerMatch | null>(prefill);
  const [principal, setPrincipal] = useState("");
  const [months, setMonths] = useState<LoanDuration>(3);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Whether they may borrow, and how far, is per customer — so ask on pick.
  const gate = useFetcher<{
    eligibility: LoanEligibility | null;
    error: string | null;
  }>();
  useEffect(() => {
    if (customer) gate.load(`/loans/eligibility?customerId=${customer.id}`);
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
    setPrincipal("");
    setMonths(3);
  }

  const checking = customer !== null && gate.state === "loading";
  const eligibility = customer ? (gate.data?.eligibility ?? null) : null;
  const blocker = eligibility ? applicationBlocker(eligibility) : null;

  // Until eligibility lands, assume the cautious ceiling.
  const ceiling = eligibility?.bigTierUnlocked
    ? config.bigMaxPesewas
    : config.smallMaxPesewas;

  const probe = new FormData();
  probe.set("principal", principal);
  probe.set("durationMonths", String(months));
  const { fieldErrors: liveErrors } = readLoanApplicationForm(probe, config, {
    bigTierUnlocked: eligibility?.bigTierUnlocked ?? false,
  });
  const pesewas = parseGhsAmount(principal);
  const ready =
    customer !== null &&
    eligibility !== null &&
    blocker === null &&
    pesewas !== null &&
    Object.keys(liveErrors).length === 0;

  const rate = rateFor(config, months);
  const interest = pesewas === null ? 0 : projectInterest(pesewas, rate);
  const totalDue = pesewas === null ? 0 : projectTotalDue(pesewas, rate);
  const instalments = projectInstalments(totalDue, months);
  const tier = pesewas === null ? null : tierFor(config, pesewas);

  function confirmAndSend() {
    setConfirming(false);
    if (formRef.current) submit(formRef.current, { method: "post" });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        className="min-h-8 rounded-md bg-success px-3"
        onPress={() => setOpen(true)}
      >
        <HandCoins size={14} />
        Start an application
      </Button>

      <SideDrawer
        isOpen={open}
        onClose={close}
        title="Apply for a loan"
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
              type="button"
              className="rounded-md bg-success"
              isDisabled={submitting || !ready}
              onPress={() => setConfirming(true)}
            >
              {submitting ? "Recording…" : "Record application"}
            </Button>
          </>
        }
      >
        <ConfirmModal
          isOpen={confirming}
          onOpenChange={setConfirming}
          title="Record this application?"
          closeLabel="Back"
          className="z-60"
          footer={
            <Button
              size="sm"
              className="rounded-md bg-success"
              onPress={confirmAndSend}
            >
              Record application
            </Button>
          }
        >
          <div className="space-y-3 text-sm text-muted">
            <p>
              This records a <span className="font-medium">pending</span>{" "}
              application for{" "}
              <span className="font-medium text-foreground">
                {customer?.fullName}
              </span>
              . No money moves and no rate is locked until someone approves it.
            </p>
            <dl className="space-y-2 rounded-lg border border-border bg-background p-3">
              <Figure label="Principal" value={formatGhs(pesewas ?? 0)} strong />
              <Figure label="Term" value={`${months} months`} />
              <Figure label="Rate today" value={`${rate}%`} />
              <Figure label="Total repayable" value={formatGhs(totalDue)} />
            </dl>
          </div>
        </ConfirmModal>

        <Form
          ref={formRef}
          method="post"
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) setConfirming(true);
          }}
        >
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
              Checking what they can borrow…
            </p>
          )}

          {gate.data?.error && (
            <p className="rounded-lg border-2 border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
              {gate.data.error}
            </p>
          )}

          {blocker && (
            <div className="rounded-lg border-2 border-warning/40 bg-warning/10 px-3 py-2">
              <p className="text-sm font-medium text-foreground">
                {blocker.title}
              </p>
              <p className="mt-0.5 text-xs text-muted">{blocker.detail}</p>
            </div>
          )}

          {/* The amount only makes sense once we know their ceiling. */}
          {eligibility && !blocker && (
            <>
              <div className="space-y-1.5">
                <TextInput
                  name="principal"
                  label="Loan amount"
                  value={principal}
                  onChange={setPrincipal}
                  inputProps={{
                    inputMode: "decimal",
                    autoComplete: "off",
                    placeholder: "1000.00",
                    className: FIELD,
                  }}
                />
                <p className="text-xs text-muted">
                  {formatGhs(config.smallMinPesewas)} to {formatGhs(ceiling)}
                  {tier && ` · ${LOAN_TIER_LABELS[tier]} tier`}
                </p>
                <FieldError
                  message={
                    principal
                      ? (liveErrors.principal ?? fieldErrors?.principal)
                      : fieldErrors?.principal
                  }
                />
              </div>

              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium text-foreground">
                  Term
                </legend>
                <input type="hidden" name="durationMonths" value={months} />
                <div className="flex gap-2">
                  {LOAN_DURATIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={months === option}
                      onClick={() => setMonths(option)}
                      className={`flex-1 rounded-md border-2 px-3 py-2 text-sm transition-colors ${
                        months === option
                          ? "border-success font-semibold text-foreground"
                          : "border-border font-medium text-muted hover:text-foreground"
                      }`}
                    >
                      {option} months
                      <span className="block text-xs font-normal text-muted">
                        {rateFor(config, option)}%
                      </span>
                    </button>
                  ))}
                </div>
                <FieldError message={fieldErrors?.durationMonths} />
              </fieldset>

              <dl className="space-y-2 rounded-lg border-2 border-border bg-background p-3">
                <Figure label="Principal" value={formatGhs(pesewas ?? 0)} />
                <Figure
                  label={`Interest at ${rate}%`}
                  value={formatGhs(interest)}
                />
                <Figure
                  label="Total repayable"
                  value={formatGhs(totalDue)}
                  strong
                />
                <Figure
                  label={`Monthly × ${months}`}
                  value={
                    instalments.each === instalments.last
                      ? formatGhs(instalments.each)
                      : `${formatGhs(instalments.each)} · last ${formatGhs(instalments.last)}`
                  }
                />
              </dl>

              <p className="text-xs text-muted">
                Interest is flat — a one-off percentage of the principal, not a
                monthly rate. These figures are indicative: the rate is locked
                from the settings when the loan is approved, not now.
                {!configComplete && (
                  <>
                    {" "}
                    <span className="text-warning-foreground dark:text-warning">
                      The loan settings couldn't be read in full, so some of
                      these bounds are defaults — check them in Loan settings.
                    </span>
                  </>
                )}
              </p>
            </>
          )}
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

export default function Loans({ loaderData, actionData }: Route.ComponentProps) {
  const { result, config, configComplete, prefill, filters } = loaderData;
  const navigation = useNavigation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(filters.search);
  // Bumped on every application recorded, to remount the drawer empty.
  const [recorded, setRecorded] = useState(0);

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
      notify.success(actionData.message ?? "Application recorded.");
      setRecorded((count) => count + 1);
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
      console.error("[loans] request failed:", actionData.failure);
  }, [actionData]);

  // "All loans" is the loader's default, so it needs no parameter of its own.
  function statusHref(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("status", value);
    else next.delete("status");
    next.delete("page");
    const qs = next.toString();
    return `/loans${qs ? `?${qs}` : ""}`;
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
            Loans
          </h1>
          <p className="mt-1 text-sm text-muted">
            An application is recorded against a customer, with their saving
            history in front of it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ApplyDrawer
            key={recorded}
            config={config}
            configComplete={configComplete}
            prefill={prefill}
            fieldErrors={actionData?.fieldErrors}
            formError={actionData?.formError}
          />
          <Link
            to="/settings/loans"
            className="flex min-h-8 items-center gap-1.5 rounded-md border-2 border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-secondary"
          >
            <Settings2 size={12} />
            Loan settings
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
              aria-label="Search loans"
              value={search}
              onChange={setSearch}
              inputProps={{
                placeholder: "Customer name or phone",
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
          "Principal",
          "Term",
          "Status",
          "Repaid",
          "Applied",
          "Actions",
        ]}
        ariaLabel="Loan book"
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
              ? "No loans"
              : `Showing ${(result.page - 1) * result.limit + 1}–${Math.min(
                  result.page * result.limit,
                  result.total,
                )} of ${result.total}`
        }
        emptyContent={{
          icon: <HandCoins size={20} />,
          title: "No loans found",
          subtext: filters.search
            ? `Nothing matches “${filters.search}”.`
            : filters.status
              ? `No loans are ${LOAN_STATUS_LABELS[filters.status as LoanStatus].toLowerCase()}.`
              : "Record the first one — search for the customer as you go.",
        }}
      >
        {result.items.map((loan) => (
          <Table.Row key={loan.id} id={loan.id}>
            <Table.Cell className="px-4 py-2 font-medium text-foreground">
              <Link
                to={`/loans/${loan.id}`}
                className="block truncate hover:text-success hover:underline"
              >
                {loan.customerName ?? "Unnamed customer"}
              </Link>
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {formatGhs(loan.principal, { symbol: null })}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">
              {loan.durationMonths} mo · {loan.ratePercent}%
            </Table.Cell>
            <Table.Cell className="px-4 py-2">
              <LoanStatusPill loan={loan} />
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {loan.status === "pending" || loan.status === "rejected" ? (
                "—"
              ) : (
                <span className="block">
                  {formatGhs(loan.totalRepaid, { symbol: null })} of{" "}
                  {formatGhs(loan.totalDue, { symbol: null })}
                  <span className="mt-1 block h-1 w-24 overflow-hidden rounded-full bg-border">
                    <span
                      className="block h-full rounded-full bg-success"
                      style={{ width: `${repaidPercent(loan)}%` }}
                    />
                  </span>
                </span>
              )}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">
              {formatDate(loan.appliedAt)}
            </Table.Cell>
            <Table.Cell className="px-4 py-2">
              <IconLink
                label={`Open ${loan.customerName ?? "this"} loan`}
                to={`/loans/${loan.id}`}
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

