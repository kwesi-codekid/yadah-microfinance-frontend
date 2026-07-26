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

/**
 * Everything one customer is saving into, in one place.
 *
 * This is where an account is reached from — there is no cross-customer ledger
 * page. A susu cycle runs 31 days and a customer opens a fresh one about every
 * month (sometimes several at once, at different daily amounts), so the list
 * grows without limit and is paged and filtered by status rather than shown
 * whole. Active is the working set; the rest are history you go looking for.
 *
 * **One list, switched by product.** Susu and savings were briefly two stacked
 * sections, each with its own filter, its own Open button and its own paging.
 * That put two of every control on the page and made the second product a thing
 * you scrolled to. They are one question — "what is this customer saving into?"
 * — asked of two ledgers, so the product is a filter above one list like any
 * other, and everything below it belongs to whichever is selected.
 *
 * It also means only the selected product is fetched, where two sections had to
 * load both on every visit.
 *
 * The filters are product-specific and reset together when the product changes:
 * susu has three statuses to savings' two, and an account number is six digits
 * on one and ten on the other — a susu number carried across would search for
 * something that cannot exist.
 */

/** The two ledgers this page switches between. */
type Product = "susu" | "savings";

const PRODUCTS: { value: Product; label: string }[] = [
  { value: "susu", label: "Susu" },
  { value: "savings", label: "Savings" },
];

/** Account numbers are six digits for susu and ten for savings. */
const NUMBER_LENGTH: Record<Product, number> = { susu: 6, savings: 10 };

// Ties the mobile filter toggle to the group it opens, and the product switch
// to the list it controls.
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

  /**
   * The number printed on the customer's card.
   *
   * Digits only and truncated to the selected product's length rather than
   * trusted: the field is the one place a counter types, and `?accountNumber=abc`
   * is a URL anyone can hand over. A partial number is dropped instead of sent,
   * because the API matches the whole number and a prefix would come back as "no
   * such account" when the truth is "keep typing".
   */
  const length = NUMBER_LENGTH[product];
  const typed = (sp.get("accountNumber") ?? "")
    .replace(/\D/g, "")
    .slice(0, length);
  const accountNumber = typed.length === length ? typed : undefined;

  /**
   * "All" is a real choice: the API returns every status when the filter is
   * omitted. Which statuses exist depends on the product — susu accounts can be
   * mid-cycle, full, or paid out; a savings account is simply open or closed —
   * so the parameter is validated against the product rather than in general,
   * and an inapplicable one (`completed` carried over to savings) falls back to
   * `active` instead of being sent to be rejected.
   */
  const statusParam = sp.get("status");
  const valid =
    product === "susu"
      ? isSusuAccountStatus(statusParam)
      : isSavingsAccountStatus(statusParam);
  const selected = valid || statusParam === "all" ? statusParam! : "active";

  /**
   * A number search ignores the status filter.
   *
   * Someone reading a number off a card doesn't know whether that account is
   * still running, and an empty page for an account that plainly exists is the
   * worst answer this screen can give. The filter is what you browse with; the
   * number is what you look up.
   */
  const filtered = accountNumber || selected === "all" ? undefined : selected;

  const { data: result, headers } = await withAuth(request, async (token) => {
    // The customer is fetched for their name and status, not decoration: an
    // inactive customer can't be given an account (422 CUSTOMER_INACTIVE), so
    // the button is withheld rather than offered and refused.
    const [customer, accounts] = await Promise.all([
      customersApi.getCustomer(token, params.id),
      // Scoped to this customer either way: a number belonging to someone else
      // returns nothing here rather than another person's account.
      product === "susu"
        ? susuApi
            .listSusuAccounts(token, {
              customerId: params.id,
              page,
              limit,
              status: filtered as SusuAccountStatus | undefined,
              accountNumber,
            })
            .then((r) => ({ ...r, product: "susu" as const }))
        : savingsApi
            .listSavingsAccounts(token, {
              customerId: params.id,
              page,
              limit,
              status: filtered as SavingsAccountStatus | undefined,
              accountNumber,
            })
            .then((r) => ({ ...r, product: "savings" as const })),
    ]);
    return { customer: customer.customer, accounts };
  }).catch(throwAsRouteError); // 404

  return data(
    {
      customer: result.customer,
      accounts: result.accounts,
      // `typed` rather than `accountNumber`: the field is seeded from this, and
      // a half-typed number has to survive a reload the same as a whole one.
      filters: { product, page, limit, status: selected, accountNumber: typed },
      /** Whether the digits actually narrowed the list. */
      searchingNumber: accountNumber !== undefined,
      canManage: office,
      /**
       * For a savings opening deposit, which is recorded atomically with the
       * account — see `newIdempotencyKey`. Minted here and carried in a hidden
       * field so a retried submit replays the original rather than opening a
       * second account with a second deposit in it.
       */
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
        // Both omitted when the account opens empty: the key belongs to the
        // deposit, and sending one with no deposit to protect is noise.
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
    canManage,
    savingsKey,
  } = loaderData;
  const navigation = useNavigation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();

  const product = filters.product;
  const savings = product === "savings";
  const length = NUMBER_LENGTH[product];

  const pageCount = Math.max(1, Math.ceil(accounts.total / accounts.limit));
  const loading = navigation.state === "loading";

  // The field types against local state; the URL (and so the loader) catches
  // up on a debounce. Seeded from the URL so a shared or reloaded link shows
  // the number it filtered by.
  const [number, setNumber] = useState(filters.accountNumber);
  /** Typed, but not yet the whole number — nothing has been sent. */
  const partial = number.length > 0 && number.length < length;

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

  // One request per pause in typing, and only for a number the loader will
  // actually use: the product's full length, or empty to clear.
  useEffect(() => {
    if (number === filters.accountNumber) return;
    if (number.length > 0 && number.length < length) return;
    const timer = setTimeout(() => commitNumber(number), 300);
    return () => clearTimeout(timer);
  }, [number, filters.accountNumber, length, commitNumber]);

  // Back/forward moves the URL out from under the field, so adopt it. Our own
  // updates above are REPLACE navigations, which never land here. Switching
  // product also clears the number, and this is what empties the field.
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
      {/* No page heading and no section heading: the product switch below says
          which ledger this is, and the cards carry it on their own faces. The
          trail does the work a heading would — whose accounts these are, and
          the way back up to them — in one line instead of a block. */}
      <Breadcrumbs
        className="mb-5"
        items={[
          { label: "Customers", to: "/customers" },
          { label: customer.fullName, to: `/customers/${customer.id}` },
          { label: "Accounts" },
        ]}
      />

      <section>
        {/* Tops aligned, not centres: the field carries a line of help under
            it, and centring would drop the switch, the filter and the button
            half a line below the input they sit beside. */}
        <div className="mb-4 flex flex-wrap items-start gap-3">
          {/* First in the bar, left of the field it reframes: switching product
              changes what a number in that field would even mean. It is the
              only control here that isn't inside the GET form — it navigates
              rather than submits, and it has to drop the form's own params on
              the way across. */}
          <ProductSwitch
            current={product}
            searchParams={searchParams}
            customerId={customer.id}
          />

          {/* A real GET form, so the field and the filter still work with
              JavaScript off — each carries the `name` the loader reads. The
              product it belongs to rides along in a hidden input, or a no-JS
              search would throw the page back to susu. The Open account button
              stays outside it: it posts, and a form inside a form is neither
              valid nor submittable. */}
          <Form
            method="get"
            className="flex flex-1 flex-wrap items-start gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              // Enter searches now rather than waiting out the debounce.
              if (!partial) commitNumber(number);
            }}
          >
            <input type="hidden" name="product" value={product} />

            <div className="w-full max-w-60">
              <div className="relative">
                <TextInput
                  name="accountNumber"
                  aria-label="Search by account number"
                  value={number}
                  // Digits only, and no longer than this product's number —
                  // the field can't be made to hold something the API would
                  // reject.
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
              {/* Only what the field can't say for itself. The placeholder
                  names the field and `maxLength` enforces the digit count, so
                  an idle line reciting both was standing instruction nobody
                  needed twice.

                  What's left is the two things that *are* surprising: nothing
                  happens until the number is whole, and a whole one quietly
                  overrides the status filter. The line keeps its height while
                  it has nothing to say, so the cards don't hop as it appears
                  and goes. */}
              <p className="mt-1 min-h-4 text-xs text-muted">
                {partial
                  ? `${length - number.length} more ${length - number.length === 1 ? "digit" : "digits"} to search.`
                  : searchingNumber
                    ? "Searching every status."
                    : ""}
              </p>
            </div>

            <div className="ml-auto">
              {/* Susu accounts can be mid-cycle, full, or paid out. A savings
                  account is open or closed — there is no third state to offer,
                  because there is no cycle to finish. */}
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

          {/* One button, opening whichever product is selected — the filter
              above decides what "Open account" means, the same way it decides
              what the list below shows. */}
          {canManage &&
            customer.status === "active" &&
            (savings ? (
              <OpenSavingsButton
                // Remounts once the account exists, which clears the dialog. A
                // rejected submit leaves the total unchanged, so the typed
                // value survives to be corrected.
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

        {/* Cards, not rows: an account has four facts worth reading and a
            shape everyone already knows how to hold. The grid fills to the
            width it's given rather than fixing a column count — one card on a
            phone, four on a monitor, and the cards keep their proportions.

            `aria-live` because the product switch and the filters replace this
            list in place: without it, a screen reader is told nothing when the
            thing the controls point at has changed underneath. */}
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
                  // A number that found nothing is its own answer: the filter
                  // wasn't what hid it, so don't send anyone to change it.
                  title: searchingNumber
                    ? `No account ${filters.accountNumber}`
                    : filters.status === "active"
                      ? savings
                        ? "No savings account"
                        : "No active susu account"
                      : `No ${savings ? "savings" : "susu"} accounts found`,
                  subtext: searchingNumber
                    ? `${customer.fullName} holds no ${savings ? "savings" : "susu"} account with that number. Check the digits, or clear the search.`
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
              {/* Narrowed by the product the loader was asked for, so each
                  branch has the account shape its card wants. */}
              {accounts.product === "savings"
                ? accounts.items.map((account) => (
                    <li key={account.id}>
                      <SavingsCard account={account} />
                    </li>
                  ))
                : accounts.items.map((account) => (
                    <li key={account.id}>
                      <AccountCard account={account} />
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

/**
 * Susu or savings — the switch everything else on the page answers to.
 *
 * Two links rather than a dropdown. It is the page's primary axis, not one
 * filter among several: a dropdown would hide the existence of the other
 * product behind a click, and this is the one control that changes what the
 * filter, the search field, the Open button and the cards all mean. Both
 * options visible is the point.
 *
 * Real links, so each product has a URL that can be shared and the pair works
 * with JavaScript off. They drop `status`, `accountNumber` and `page` on the
 * way across: statuses differ between the products, a six-digit susu number
 * can never match a ten-digit savings one, and page 3 of one list means
 * nothing in the other.
 *
 * Sized off `FIELD` and a 2px border, exactly as the input and the status
 * select beside it are, so the three share one height by sharing one recipe
 * rather than by three numbers that happen to agree today. `FilterSelect` gave
 * up HeroUI's `Select` over the same constant.
 */
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
    // Susu is the default, so its link is the bare path — the tidier URL, and
    // the one someone lands on from the customer record.
    if (product === "savings") next.set("product", "savings");
    else next.delete("product");
    const qs = next.toString();
    return `/customers/${customerId}/accounts${qs ? `?${qs}` : ""}`;
  }

  return (
    <div
      role="tablist"
      aria-label="Account product"
      // Height comes from `FIELD` and the same 2px border the input and the
      // status select use — the same recipe rather than a number picked to
      // match it, so the three can't drift apart when that constant changes.
      // The segments carry no height of their own; `items-stretch` (flex's
      // default) has them fill whatever the container resolves to.
      //
      // `shrink-0` so the pair never squeezes: the field beside it is what
      // gives way as the bar narrows, and a half-width "Savings" is unreadable
      // where a shorter input still works.
      className={`${FIELD} inline-flex shrink-0 overflow-hidden border-2 border-border bg-field`}
    >
      {PRODUCTS.map(({ value, label }) => {
        const selected = value === current;
        return (
          <Link
            key={value}
            to={href(value)}
            role="tab"
            aria-selected={selected}
            aria-controls={LIST_ID}
            // The bar's own controls don't move the page, and neither should
            // this — the list it swaps is already under the cursor.
            preventScrollReset
            className={[
              "flex items-center px-3.5 text-sm font-medium transition-colors",
              selected
                ? "bg-success text-white"
                : "text-muted hover:bg-background hover:text-foreground",
            ].join(" ")}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Open a cycle, from the bar above the list.
 *
 * The daily amount is fixed for the life of the cycle — the only way to change
 * it is to close the account and open another — so the drawer does double duty:
 * it takes the amount and, as you type, states what it commits to. Reading back
 * `GHS 50,000.00` is what catches the missing decimal point; a ceiling invented
 * here would eventually refuse an account the API would have allowed.
 *
 * A drawer rather than a modal, matching the deposit and withdrawal forms on
 * the account pages — opening an account is the same kind of act as those, and
 * it was the odd one out. It buys something concrete too: `SideDrawer` renders
 * in place rather than in a portal, so the field can sit in a real `<Form>`
 * with its own `name` instead of being mirrored into a hidden input by a
 * `requestSubmit` on a second form. Enter submits, and the pending state has
 * somewhere to show.
 */
function OpenAccountButton({ error }: { error?: string }) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const pesewas = parseGhsAmount(amount);
  const valid = pesewas !== null && pesewas >= SUSU_MIN_DAILY_AMOUNT;

  // A rejected submit has to bring the drawer back, or the message lands on a
  // field that is no longer on screen. Adjusted during render rather than in an
  // effect, so there is no pass with the error set and the drawer still closed.
  const [seenError, setSeenError] = useState(error);
  if (error !== seenError) {
    setSeenError(error);
    if (error) setOpen(true);
  }

  // The footer sits outside the form the drawer scrolls, so the submit button
  // points back at it by id.
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

      {/* Nothing closes this on success: opening an account changes the list's
          total, which is this component's `key`, so it remounts clean. A
          rejected submit leaves the total alone, and the drawer stays open with
          the typed amount and the message on the field. */}
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
            {/* Only once there is an amount to talk about — a sentence full of
                GHS 0.00 before anyone has typed is noise.

                Below the floor the button is disabled, so the reason has to be
                on screen: a dead button with no explanation reads as a broken
                form. This says it before the submit rather than letting the
                API answer with a 400. */}
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

/**
 * Open a savings account, from the same slot in the same bar.
 *
 * Nothing about a savings account is fixed at opening — no daily amount, no
 * cycle — so unlike the susu dialog this asks for almost nothing. The one field
 * is an *optional* opening deposit, which the API records atomically with the
 * account: there is no window where a half-opened account exists with the cash
 * already counted into the drawer.
 */
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
  // Blank is valid — the account can open empty. Only a typed amount has to
  // clear the floor.
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
          {/* The key belongs to the opening deposit, which the API records
              atomically with the account — a retry must replay it rather than
              open a second account with a second deposit in it. Sent even when
              the field is blank; the action drops it along with the deposit. */}
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          {/* Cash. An opening deposit is counted over the counter at the moment
              the account is created, so there is no channel to choose — unlike
              a later deposit, which the savings page does ask about. */}
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
            {/* Below the floor the button is disabled, so the reason has to be
                on screen — a dead button with no explanation reads as a broken
                dialog. Leaving the field blank is not below the floor: it opens
                the account with nothing in it, which is allowed. */}
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
