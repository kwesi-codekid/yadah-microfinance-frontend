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

/**
 * The icons are the same two the dashboard's book panel uses for the same two
 * ledgers — a tab is not the place to introduce a second visual name for
 * something the app has already named.
 *
 * The tone is the face the product's own cards wear (`SAVINGS_FACE` is navy,
 * `FACE.active` is teal), so the selected tab is ringed in the colour of the
 * grid it is about to show. Read off `account-card.tsx` by eye rather than
 * imported: those constants are Tailwind *fill* classes, and a `bg-navy` cannot
 * be turned into a `ring-navy` without string surgery that would break the
 * moment either name changed.
 */
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

/** Account numbers are six digits for susu and ten for savings. */
const NUMBER_LENGTH: Record<Product, number> = { susu: 6, savings: 10 };

/* ------------------------------------------------------------------ *
 * Searching by a partial number
 *
 * The API matches account numbers whole and only whole — `accountNumber` on
 * `GET /susu/accounts` is documented as exactly six digits, and a prefix comes
 * back as "no such account" rather than as a shortlist. So a search that
 * narrows as you type cannot be a query parameter; it has to be a match run
 * over the accounts themselves.
 *
 * That is affordable here only because the list is already scoped to one
 * customer. One person's accounts are a handful — every cycle they have ever
 * run, plus their savings — not the whole book, so the scan below reads a
 * bounded set and does it only while there are digits in the field. Browsing
 * with an empty field still pages against the API exactly as before, and this
 * costs nothing.
 *
 * Do not lift this to a page that lists every customer's accounts. There the
 * same code would read the entire book on every keystroke, and the answer is a
 * `q`-style parameter on the API instead.
 * ------------------------------------------------------------------ */

/** Page size while scanning, and the ceiling on how many pages a scan reads. */
const SCAN_LIMIT = 100;
const SCAN_MAX_PAGES = 5;

/**
 * Every account this customer has, up to `SCAN_MAX_PAGES` pages.
 *
 * The cap is a backstop, not a budget: 500 accounts for one person is already
 * far past anything real, and it exists so a bad `customerId` or a runaway
 * fixture can't turn one keystroke into an unbounded run of requests. When it
 * bites, `truncated` says so and the page prints a warning rather than quietly
 * reporting "no match" for an account that is simply past the cap.
 */
async function scanAccounts<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; total: number }>,
): Promise<{ items: T[]; truncated: boolean }> {
  const first = await fetchPage(1);
  const pages = Math.min(SCAN_MAX_PAGES, Math.ceil(first.total / SCAN_LIMIT));
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => fetchPage(i + 2)),
  );
  const items = [first.items, ...rest.map((r) => r.items)].flat();
  return { items, truncated: items.length < first.total };
}

/**
 * The matches for what has been typed, as one page of them.
 *
 * `includes` rather than `startsWith`: the digits someone has are not always
 * the leading ones. A number read aloud over a phone arrives in pieces, and the
 * fragment legible on a worn card is as often the tail as the head.
 *
 * Ranked so the closer match wins. A prefix match is what you get when someone
 * is typing a number they know from the front, and burying it under an account
 * that merely contains those digits in the middle would make the list feel
 * wrong exactly when it is being used properly. Ties fall back to the number
 * itself, so the order is stable between keystrokes instead of reshuffling.
 */
function matchNumber<T extends { accountNumber: string }>(
  items: T[],
  typed: string,
): T[] {
  return items
    .filter((item) => item.accountNumber.includes(typed))
    .sort((a, b) => {
      const byPrefix =
        Number(b.accountNumber.startsWith(typed)) -
        Number(a.accountNumber.startsWith(typed));
      return byPrefix || a.accountNumber.localeCompare(b.accountNumber);
    });
}

/**
 * One page of a list already in hand, in the shape the API's own list results
 * come back in, so the component can't tell which branch filled it.
 *
 * The page is clamped rather than trusted. Deleting a digit widens the match
 * set, but typing one narrows it, and `?page=3` survives in the URL from the
 * previous, longer list — without the clamp, narrowing to two matches while on
 * page 3 shows an empty grid under a pager that says there is only one page.
 */
function pageOf<T>(items: T[], page: number, limit: number) {
  const last = Math.max(1, Math.ceil(items.length / limit));
  const current = Math.min(page, last);
  return {
    items: items.slice((current - 1) * limit, current * limit),
    page: current,
    limit,
    total: items.length,
  };
}

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
   * The number printed on the customer's card, or as much of it as has been
   * typed.
   *
   * Digits only and truncated to the selected product's length rather than
   * trusted: the field is the one place a counter types, and `?accountNumber=abc`
   * is a URL anyone can hand over. One digit is enough to search — see the scan
   * above — so unlike before, nothing is dropped for being incomplete.
   */
  const length = NUMBER_LENGTH[product];
  const typed = (sp.get("accountNumber") ?? "")
    .replace(/\D/g, "")
    .slice(0, length);
  const searchingNumber = typed.length > 0;

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
  const filtered = searchingNumber || selected === "all" ? undefined : selected;

  const { data: result, headers } = await withAuth(request, async (token) => {
    // The customer is fetched for their name and status, not decoration: an
    // inactive customer can't be given an account (422 CUSTOMER_INACTIVE), so
    // the button is withheld rather than offered and refused.
    /**
     * Two ways to fill the grid, and which one runs is decided by whether
     * there is anything in the field.
     *
     * Browsing pages against the API, one page per request, exactly as it
     * always did. Searching reads the customer's accounts and matches them
     * here, then pages the matches itself — the API can't narrow on a partial
     * number, so `page` and `limit` have to be applied after the match rather
     * than before it. Sending them to the API and filtering the page that came
     * back would page through the *unmatched* list: page 2 of a search would
     * be the accounts ranked 21–40 by nothing in particular, most of them
     * matching nothing, and the real matches on page 3 would never be seen.
     */
    const [customer, accounts] = await Promise.all([
      customersApi.getCustomer(token, params.id),
      // Scoped to this customer either way: a number belonging to someone else
      // returns nothing here rather than another person's account.
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
      // The field is seeded from this, so a half-typed number has to survive a
      // reload the same as a whole one. `page` comes off the result rather
      // than off the URL — `pageOf` may have clamped it.
      filters: {
        product,
        page: result.accounts.page,
        limit,
        status: selected,
        accountNumber: typed,
      },
      /** Whether the digits are narrowing the list. Any digit does now. */
      searchingNumber,
      /**
       * Said out loud when it applies: this customer has more accounts than
       * one scan reads, so "no match" would be a claim the scan can't make.
       */
      scanTruncated: result.accounts.truncated,
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
    scanTruncated,
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

  /**
   * One request per pause in typing — every pause, at any length.
   *
   * This used to hold everything back until the number was whole, which is
   * what made the field feel dead: six digits of typing with no response, and
   * then the whole answer at once. The loader matches on a fragment now, so
   * the first digit is already a narrower list than no digits.
   *
   * The debounce is what keeps that from being one request per keystroke. It
   * stays at 300ms rather than dropping: each request is now a scan rather
   * than a lookup, so if anything a keystroke is worth *more* here than it was
   * before.
   */
  useEffect(() => {
    if (number === filters.accountNumber) return;
    const timer = setTimeout(() => commitNumber(number), 300);
    return () => clearTimeout(timer);
  }, [number, filters.accountNumber, commitNumber]);

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
                  needed twice. The "N more digits to search" line went with
                  the wait it was explaining.

                  What's left is what is genuinely surprising: the digits match
                  anywhere in the number rather than only at the front, and a
                  search quietly overrides the status filter. The count is the
                  part worth reading — it is the difference between "still
                  narrowing" and "that's the one". The line keeps its height
                  while it has nothing to say, so the cards don't hop as it
                  appears and goes. */}
              <p className="mt-1 min-h-4 text-xs text-muted">
                {searchingNumber
                  ? `${accounts.total} ${accounts.total === 1 ? "match" : "matches"} anywhere in the number, every status.`
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

        {/* Only when the scan hit its ceiling, which takes more accounts on one
            customer than this business is ever likely to see. Said anyway,
            because the alternative is an empty grid that reads as "no such
            account" when the truth is "not in the part that was read". */}
        {scanTruncated && (
          <p className="mb-4 rounded-lg border-2 border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
            This customer has more accounts than the search reads (
            {SCAN_LIMIT * SCAN_MAX_PAGES} at most). Type the whole number, or
            browse with the field empty.
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
              {/* Narrowed by the product the loader was asked for, so each
                  branch has the account shape its card wants. */}
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
 * The bar itself is `TabList` — the app's one tab shape, and the reason this
 * function no longer carries any styling of its own. It still shares a height
 * with the input and the status select beside it, because `TabList`'s track is
 * sized off the same `FIELD` constant those two are; the recipe moved, the
 * agreement didn't.
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
