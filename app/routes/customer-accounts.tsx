import { useCallback, useEffect, useState } from "react";
import {
  data,
  Form,
  Link,
  useNavigation,
  useNavigationType,
  useSearchParams,
} from "react-router";
import { Button } from "@heroui/react";
import {
  HandCoins,
  LoaderCircle,
  PiggyBank,
  Plus,
  Search,
  WalletCards,
  X,
} from "lucide-react";
import type { Route } from "./+types/customer-accounts";
import {
  AccountCard,
  AccountCardSkeleton,
  SavingsCard,
} from "~/components/account-card";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { CollectionFooter, EmptyState } from "~/components/data-table";
import { FIELD, FieldError, FilterSelect } from "~/components/form-fields";
import { TabLink, TabList, type TabTone } from "~/components/tabs";
import { TextInput } from "~/components/inputs";
import { SideDrawer } from "~/components/side-drawer";
import { notify } from "~/components/toast";
import {
  throwAsRouteError,
  toApiFailure,
  type ApiFailure,
} from "~/lib/api/client";
import * as customersApi from "~/lib/api/customers";
import * as savingsApi from "~/lib/api/savings";
import {
  ACCOUNT_NUMBER_LENGTH,
  matchNumber,
  pageOf,
  scanAccounts,
  SCAN_LIMIT,
  SCAN_MAX_PAGES,
} from "~/lib/account-scan";
import * as susuApi from "~/lib/api/susu";
import { newIdempotencyKey } from "~/lib/idempotency";
import { formatGhs, parseGhsAmount } from "~/lib/money";
import {
  isSavingsAccountStatus,
  SAVINGS_FEE,
  SAVINGS_MIN_BALANCE,
  SAVINGS_MIN_DEPOSIT,
  type SavingsAccountStatus,
} from "~/lib/savings-client";
import { readOpenSavingsForm } from "~/lib/savings-form";
import {
  isSusuAccountStatus,
  SUSU_CYCLE_TARGET,
  SUSU_MIN_DAILY_AMOUNT,
  type SusuAccountStatus,
} from "~/lib/susu-client";
import { readOpenAccountForm } from "~/lib/susu-form";
import { isOffice, requireUser, withAuth } from "~/lib/session.server";

/** The two ledgers this page switches between. */
type Product = "susu" | "savings";

const PRODUCTS: {
  value: Product;
  label: string;
  icon: React.ReactNode;
  tone: TabTone;
}[] = [
  { value: "susu", label: "Susu", icon: <HandCoins size={14} />, tone: "teal" },
  {
    value: "savings",
    label: "Savings",
    icon: <PiggyBank size={14} />,
    tone: "navy",
  },
];

const LIST_ID = "accounts-list";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `${loaderData?.customer.fullName ?? "Customer"} accounts · YADAH Dynamic Enterprise`,
    },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const office = isOffice(user);

  const sp = new URL(request.url).searchParams;
  const product: Product = sp.get("product") === "savings" ? "savings" : "susu";
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  const limit = Math.max(1, Number(sp.get("limit") || "20") || 20);

  const length = ACCOUNT_NUMBER_LENGTH[product];
  const typed = (sp.get("accountNumber") ?? "")
    .replace(/\D/g, "")
    .slice(0, length);
  const searchingNumber = typed.length > 0;

  const statusParam = sp.get("status");
  const valid =
    product === "susu"
      ? isSusuAccountStatus(statusParam)
      : isSavingsAccountStatus(statusParam);
  const selected = valid || statusParam === "all" ? statusParam! : "active";

  const filtered = searchingNumber || selected === "all" ? undefined : selected;

  const { data: result, headers } = await withAuth(request, async (token) => {
    const [customer, accounts] = await Promise.all([
      customersApi.getCustomer(token, params.id),
      product === "susu"
        ? (searchingNumber
            ? scanAccounts((p) =>
                susuApi.listSusuAccounts(token, {
                  customerId: params.id,
                  page: p,
                  limit: SCAN_LIMIT,
                }),
              ).then(({ items, truncated }) => ({
                ...pageOf(matchNumber(items, typed), page, limit),
                truncated,
              }))
            : susuApi
                .listSusuAccounts(token, {
                  customerId: params.id,
                  page,
                  limit,
                  status: filtered as SusuAccountStatus | undefined,
                })
                .then((r) => ({ ...r, truncated: false }))
          ).then((r) => ({ ...r, product: "susu" as const }))
        : (searchingNumber
            ? scanAccounts((p) =>
                savingsApi.listSavingsAccounts(token, {
                  customerId: params.id,
                  page: p,
                  limit: SCAN_LIMIT,
                }),
              ).then(({ items, truncated }) => ({
                ...pageOf(matchNumber(items, typed), page, limit),
                truncated,
              }))
            : savingsApi
                .listSavingsAccounts(token, {
                  customerId: params.id,
                  page,
                  limit,
                  status: filtered as SavingsAccountStatus | undefined,
                })
                .then((r) => ({ ...r, truncated: false }))
          ).then((r) => ({ ...r, product: "savings" as const })),
    ]);
    return { customer: customer.customer, accounts };
  }).catch(throwAsRouteError); // 404

  return data(
    {
      customer: result.customer,
      accounts: result.accounts,
      filters: {
        product,
        page: result.accounts.page,
        limit,
        status: selected,
        accountNumber: typed,
      },
      /** Whether the digits are narrowing the list. Any digit does now. */
      searchingNumber,
      scanTruncated: result.accounts.truncated,
      canManage: office,
      savingsKey: newIdempotencyKey(),
    },
    { headers },
  );
}

type ActionData = {
  ok?: boolean;
  intent?: string;
  message?: string;
  formError?: string;
  fieldErrors?: Record<string, string>;
  /** Forwarded so the browser console shows what the API actually said. */
  failure?: ApiFailure;
};

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (!isOffice(user)) {
    return data<ActionData>({
      intent,
      formError: "Only office staff can open accounts.",
    });
  }

  if (intent !== "open-susu" && intent !== "open-savings") {
    return data<ActionData>({ intent, formError: "Unsupported action." });
  }

  if (intent === "open-susu") {
    const { dailyAmount, fieldErrors } = readOpenAccountForm(form);
    if (Object.keys(fieldErrors).length)
      return data<ActionData>({ intent, fieldErrors });

    try {
      const { data: result, headers } = await withAuth(request, (token) =>
        susuApi.openSusuAccount(token, {
          customerId: params.id,
          dailyAmount,
        }),
      );
      return data<ActionData>(
        {
          ok: true,
          intent,
          message: `Susu account opened at ${formatGhs(result.account.dailyAmount)} a day.`,
        },
        { headers },
      );
    } catch (error) {
      if (error instanceof Response) throw error;
      const failure = toApiFailure(error);
      return data<ActionData>({ intent, formError: failure.message, failure });
    }
  }

  const { initialDeposit, channel, idempotencyKey, fieldErrors } =
    readOpenSavingsForm(form);
  if (Object.keys(fieldErrors).length)
    return data<ActionData>({ intent, fieldErrors });

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      savingsApi.openSavingsAccount(token, {
        customerId: params.id,
        ...(initialDeposit !== undefined
          ? { initialDeposit, idempotencyKey, channel }
          : {}),
      }),
    );
    return data<ActionData>(
      {
        ok: true,
        intent,
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
    return data<ActionData>({ intent, formError: failure.message, failure });
  }
}

export default function CustomerAccounts({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    customer,
    accounts,
    filters,
    searchingNumber,
    scanTruncated,
    canManage,
    savingsKey,
  } = loaderData;
  const navigation = useNavigation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();

  const product = filters.product;
  const savings = product === "savings";
  const length = ACCOUNT_NUMBER_LENGTH[product];

  const pageCount = Math.max(1, Math.ceil(accounts.total / accounts.limit));
  const loading = navigation.state === "loading";

  const [number, setNumber] = useState(filters.accountNumber);

  const commitNumber = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set("accountNumber", value);
          else next.delete("accountNumber");
          // A different number is a different result set — page 1 again.
          next.delete("page");
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (number === filters.accountNumber) return;
    const timer = setTimeout(() => commitNumber(number), 300);
    return () => clearTimeout(timer);
  }, [number, filters.accountNumber, commitNumber]);

  useEffect(() => {
    if (navigationType === "POP") setNumber(filters.accountNumber);
  }, [navigationType, filters.accountNumber]);

  // The number the in-flight navigation is fetching, or null when idle.
  const pending =
    navigation.state === "loading" && navigation.location
      ? (new URLSearchParams(navigation.location.search).get("accountNumber") ??
        "")
      : null;
  const searching = pending !== null && pending !== filters.accountNumber;

  useEffect(() => {
    if (actionData?.ok) notify.success(actionData.message ?? "Done.");
    else if (actionData?.formError) notify.error(actionData.formError);
    if (actionData?.failure)
      console.error("[customer-accounts] request failed:", actionData.failure);
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
      <Breadcrumbs
        className="mb-5"
        items={[
          { label: "Customers", to: "/customers" },
          { label: customer.fullName, to: `/customers/${customer.id}` },
          { label: "Accounts" },
        ]}
      />

      <section>
        <div className="mb-4 flex flex-wrap items-start gap-3">
          <ProductSwitch
            current={product}
            searchParams={searchParams}
            customerId={customer.id}
          />

          <Form
            method="get"
            className="flex flex-1 flex-wrap items-start gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              // Enter searches now rather than waiting out the debounce.
              commitNumber(number);
            }}
          >
            <input type="hidden" name="product" value={product} />

            <div className="w-full max-w-60">
              <div className="relative">
                <TextInput
                  name="accountNumber"
                  aria-label="Search by account number"
                  value={number}
                  onChange={(value) =>
                    setNumber(value.replace(/\D/g, "").slice(0, length))
                  }
                  inputProps={{
                    // `numeric` so a phone offers a keypad, not a keyboard.
                    inputMode: "numeric",
                    autoComplete: "off",
                    maxLength: length,
                    placeholder: "Account number",
                    className: `${FIELD} py-1 pl-8 ${number ? "pr-8" : ""} tabular-nums`,
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
                {number && (
                  <button
                    type="button"
                    aria-label="Clear account number"
                    onClick={() => setNumber("")}
                    className="absolute inset-y-0 right-2 my-auto flex size-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-background hover:text-foreground"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <p className="mt-1 min-h-4 text-xs text-muted">
                {searchingNumber
                  ? `${accounts.total} ${accounts.total === 1 ? "match" : "matches"} anywhere in the number, every status.`
                  : ""}
              </p>
            </div>

            <div className="ml-auto">
              <FilterSelect
                name="status"
                label="Filter by status"
                value={filters.status}
                onChange={(value) => setParam({ status: value, page: null })}
                options={
                  savings
                    ? [
                        { value: "active", label: "Active accounts" },
                        { value: "closed", label: "Closed accounts" },
                        { value: "all", label: "All accounts" },
                      ]
                    : [
                        { value: "active", label: "Active accounts" },
                        { value: "completed", label: "Completed accounts" },
                        { value: "closed", label: "Closed accounts" },
                        { value: "all", label: "All accounts" },
                      ]
                }
              />
            </div>
          </Form>

          {canManage &&
            customer.status === "active" &&
            (savings ? (
              <OpenSavingsButton
                key={`savings-${accounts.total}`}
                idempotencyKey={savingsKey}
                error={
                  actionData?.intent === "open-savings"
                    ? actionData.fieldErrors?.initialDeposit
                    : undefined
                }
              />
            ) : (
              <OpenAccountButton
                key={`susu-${accounts.total}`}
                error={
                  actionData?.intent === "open-susu"
                    ? actionData.fieldErrors?.dailyAmount
                    : undefined
                }
              />
            ))}
        </div>

        {canManage && customer.status !== "active" && (
          <p className="mb-4 text-sm text-muted">
            Reactivate this customer to open an account.
          </p>
        )}

        {scanTruncated && (
          <p className="mb-4 rounded-lg border-2 border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
            This customer has more accounts than the search reads (
            {SCAN_LIMIT * SCAN_MAX_PAGES} at most). Type the whole number, or
            browse with the field empty.
          </p>
        )}

        <div id={LIST_ID} aria-live="polite">
          {loading ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-4">
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i}>
                  <AccountCardSkeleton />
                </li>
              ))}
            </ul>
          ) : accounts.items.length === 0 ? (
            <div className="rounded-lg border-2 border-border bg-surface">
              <EmptyState
                content={{
                  icon: savings ? (
                    <PiggyBank size={64} strokeWidth={1.5} />
                  ) : (
                    <WalletCards size={64} strokeWidth={1.5} />
                  ),
                  title: searchingNumber
                    ? `No number contains ${filters.accountNumber}`
                    : filters.status === "active"
                      ? savings
                        ? "No savings account"
                        : "No active susu account"
                      : `No ${savings ? "savings" : "susu"} accounts found`,
                  subtext: searchingNumber
                    ? `No ${savings ? "savings" : "susu"} account of ${customer.fullName}'s has those digits anywhere in its number, in any status. Check them, or clear the search.`
                    : filters.status === "active"
                      ? savings
                        ? `Open one to start a balance — ${formatGhs(SAVINGS_MIN_DEPOSIT)} minimum a deposit, withdraw any day.`
                        : "Open one to start a 31-day cycle — or switch the filter to see finished ones."
                      : "Nothing matches this filter.",
                }}
              />
            </div>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-4">
              {accounts.product === "savings"
                ? accounts.items.map((account) => (
                    <li key={account.id}>
                      <SavingsCard
                        account={account}
                        holderName={customer.fullName}
                      />
                    </li>
                  ))
                : accounts.items.map((account) => (
                    <li key={account.id}>
                      <AccountCard
                        account={account}
                        holderName={customer.fullName}
                      />
                    </li>
                  ))}
            </ul>
          )}
        </div>

        {accounts.items.length > 0 && (
          <div className="mt-6">
            <CollectionFooter
              page={accounts.page}
              pageCount={pageCount}
              onPageChange={(p) => setParam({ page: String(p) })}
              pageSize={accounts.limit}
              pageSizeOptions={[12, 24, 48]}
              onPageSizeChange={(s) =>
                setParam({ limit: String(s), page: "1" })
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}

function ProductSwitch({
  current,
  searchParams,
  customerId,
}: {
  current: Product;
  searchParams: URLSearchParams;
  customerId: string;
}) {
  function href(product: Product) {
    const next = new URLSearchParams(searchParams);
    next.delete("status");
    next.delete("accountNumber");
    next.delete("page");
    if (product === "savings") next.set("product", "savings");
    else next.delete("product");
    const qs = next.toString();
    return `/customers/${customerId}/accounts${qs ? `?${qs}` : ""}`;
  }

  return (
    <TabList label="Account product">
      {PRODUCTS.map(({ value, label, icon, tone }) => (
        <TabLink
          key={value}
          to={href(value)}
          selected={value === current}
          controls={LIST_ID}
          icon={icon}
          tone={tone}
        >
          {label}
        </TabLink>
      ))}
    </TabList>
  );
}

function OpenAccountButton({ error }: { error?: string }) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const pesewas = parseGhsAmount(amount);
  const valid = pesewas !== null && pesewas >= SUSU_MIN_DAILY_AMOUNT;

  const [seenError, setSeenError] = useState(error);
  if (error !== seenError) {
    setSeenError(error);
    if (error) setOpen(true);
  }

  const formId = "open-susu-account";

  return (
    <>
      <Button
        type="button"
        size="sm"
        // 32px, the height of the filter select it now stands beside.
        className="min-h-8 rounded-md bg-success px-3"
        onPress={() => setOpen(true)}
      >
        <Plus size={14} />
        Open account
      </Button>

      <SideDrawer
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Open a susu account"
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              className="rounded-md"
              onPress={() => setOpen(false)}
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
          <input type="hidden" name="intent" value="open-susu" />

          <div className="space-y-1.5">
            <TextInput
              name="dailyAmount"
              label="Daily amount"
              value={amount}
              onChange={setAmount}
              autoFocus
              inputProps={{
                // `decimal` so a phone keypad offers the point for pesewas.
                inputMode: "decimal",
                autoComplete: "off",
                placeholder: "5.00",
                className: FIELD,
              }}
            />
            <FieldError message={error} />
          </div>

          <div className="space-y-3 text-sm text-muted">
            {valid ? (
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

function OpenSavingsButton({
  idempotencyKey,
  error,
}: {
  idempotencyKey: string;
  error?: string;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const pesewas = parseGhsAmount(amount);
  const belowFloor =
    amount.trim() !== "" && (pesewas === null || pesewas < SAVINGS_MIN_DEPOSIT);

  const [seenError, setSeenError] = useState(error);
  if (error !== seenError) {
    setSeenError(error);
    if (error) setOpen(true);
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
        Open account
      </Button>

      <SideDrawer
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Open a savings account"
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              className="rounded-md"
              onPress={() => setOpen(false)}
              isDisabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              className="rounded-md bg-success"
              isDisabled={submitting || belowFloor}
            >
              {submitting ? "Opening…" : "Open account"}
            </Button>
          </>
        }
      >
        <Form id={formId} method="post" className="space-y-5">
          <input type="hidden" name="intent" value="open-savings" />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <input type="hidden" name="channel" value="cash" />

          <div className="space-y-1.5">
            <TextInput
              name="initialDeposit"
              label="Opening deposit (optional)"
              value={amount}
              onChange={setAmount}
              autoFocus
              inputProps={{
                inputMode: "decimal",
                autoComplete: "off",
                placeholder: "0.00",
                className: FIELD,
              }}
            />
            <FieldError message={error} />
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
