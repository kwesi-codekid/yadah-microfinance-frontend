import { useCallback, useEffect, useState } from "react";
import {
  data,
  Form,
  Link,
  useNavigation,
  useSearchParams,
} from "react-router";
import { Button } from "@heroui/react";
import {
  ArrowLeft,
  HandCoins,
  LoaderCircle,
  Search,
  TriangleAlert,
} from "lucide-react";
import type { Route } from "./+types/collections";
import { FIELD, FieldError, SelectField } from "~/components/form-fields";
import { TextInput } from "~/components/inputs";
import { notify } from "~/components/toast";
import {
  throwAsRouteError,
  toApiFailure,
  type ApiFailure,
} from "~/lib/api/client";
import * as customersApi from "~/lib/api/customers";
import * as susuApi from "~/lib/api/susu";
import { formatGhs, toAmountInput } from "~/lib/money";
import { readCollectAllForm } from "~/lib/susu-form";
import {
  collectAllTotal,
  DEPOSIT_CHANNEL_LABELS,
  DEPOSIT_CHANNELS,
  newIdempotencyKey,
  readAmountMismatch,
  type SusuAccount,
} from "~/lib/susu-client";
import { requireUser, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Collect · YADAH Dynamic Enterprise" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  // Collectors are the point of this page; the API scopes both the customer
  // list and the collection itself to their own assigned customers.
  await requireUser(request);

  const sp = new URL(request.url).searchParams;
  const customerId = sp.get("customer")?.trim() || undefined;
  const search = sp.get("search")?.trim() || undefined;

  const { data: result, headers } = await withAuth(request, async (token) => {
    // Nobody chosen yet: this is the picker, so fetch the shortlist.
    if (!customerId) {
      const customers = await customersApi.listCustomers(token, {
        status: "active",
        search,
        limit: 20,
      });
      return { customers: customers.items, customer: null, accounts: [] };
    }

    const [customer, accounts] = await Promise.all([
      // A `?customer=` id that doesn't exist, or belongs to someone else's
      // round, should render as a real 404/403 page rather than a generic
      // "unexpected error" — this URL is one people share and bookmark.
      customersApi.getCustomer(token, customerId).catch(throwAsRouteError),
      // Only active accounts can take a deposit, and only they count towards
      // the total the API expects. 100 covers any customer's holdings.
      susuApi.listSusuAccounts(token, {
        customerId,
        status: "active",
        limit: 100,
      }),
    ]);
    return {
      customers: [],
      customer: customer.customer,
      accounts: accounts.items,
    };
  });

  return data(
    {
      customers: result.customers,
      customer: result.customer
        ? { id: result.customer.id, fullName: result.customer.fullName }
        : null,
      accounts: result.accounts,
      search: search ?? "",
      // Minted per page load and carried in a hidden field — a retry replays
      // the original batch rather than collecting a second day's money.
      idempotencyKey: newIdempotencyKey(),
    },
    { headers },
  );
}

type ActionData = {
  ok?: boolean;
  message?: string;
  formError?: string;
  fieldErrors?: Record<string, string>;
  /** From a 422 AMOUNT_MISMATCH — the total the API actually expected. */
  requiredAmount?: number;
  failure?: ApiFailure;
};

export async function action({ request }: Route.ActionArgs) {
  await requireUser(request);
  const form = await request.formData();
  const customerId = String(form.get("customerId") ?? "");

  const { amount, channel, idempotencyKey, fieldErrors } =
    readCollectAllForm(form);
  if (Object.keys(fieldErrors).length)
    return data<ActionData>({ fieldErrors });

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      susuApi.collectAll(token, {
        customerId,
        amount,
        idempotencyKey,
        channel,
      }),
    );

    const count = result.deposits.length;
    return data<ActionData>(
      {
        ok: true,
        message: result.replayed
          ? "Already collected — this is the same batch, not a second one."
          : `Collected ${formatGhs(result.totalAmount)} across ${count} ${count === 1 ? "account" : "accounts"}.`,
      },
      { headers },
    );
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const failure = toApiFailure(error);

    // The amount has to equal the sum of the active accounts' daily amounts.
    // When it doesn't, the API sends the figure it wanted — which is the only
    // number that can fix the form, so it goes on the field.
    const mismatch = readAmountMismatch(failure.details);
    if (mismatch) {
      return data<ActionData>({
        fieldErrors: {
          amount: `One day across these accounts is ${formatGhs(mismatch.required)}. Collect exactly that, or record the deposits one account at a time.`,
        },
        requiredAmount: mismatch.required,
        failure,
      });
    }

    return data<ActionData>({
      formError:
        failure.status === 0
          ? "Something went wrong. Please try again."
          : failure.code === "NO_ACTIVE_ACCOUNTS"
            ? "This customer has no active susu account to collect into."
            : failure.message,
      failure,
    });
  }
}

export default function Collections({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { customer, accounts, customers, search, idempotencyKey } = loaderData;

  useEffect(() => {
    if (actionData?.ok) notify.success(actionData.message ?? "Done.");
    else if (actionData?.formError) notify.error(actionData.formError);
    if (actionData?.failure)
      console.error("[collections] request failed:", actionData.failure);
  }, [actionData]);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Collect
        </h1>
        <p className="mt-1 text-sm text-muted">
          One amount, split across everything this customer is saving into.
        </p>
      </div>

      {customer ? (
        <CollectPanel
          // Keyed on the customer so editing `?customer=` in the URL remounts
          // the panel. Without it the amount field would keep the total it was
          // seeded with for the previous customer.
          key={customer.id}
          customer={customer}
          accounts={accounts}
          idempotencyKey={idempotencyKey}
          fieldErrors={actionData?.fieldErrors}
          requiredAmount={actionData?.requiredAmount}
        />
      ) : (
        <CustomerPicker customers={customers} search={search} />
      )}
    </div>
  );
}

/**
 * Step one: who is paying.
 *
 * A search rather than a dropdown — a collector knows the name, and a list of
 * every customer is neither scrollable on a phone nor bounded by the API's
 * 100-per-page ceiling.
 */
function CustomerPicker({
  customers,
  search: initialSearch,
}: {
  customers: { id: string; fullName: string; phone: string }[];
  search: string;
}) {
  const navigation = useNavigation();
  const [, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(initialSearch);

  const commitSearch = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set("search", value);
          else next.delete("search");
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setSearchParams],
  );

  // One request per pause in typing, not per keystroke.
  useEffect(() => {
    if (search === initialSearch) return;
    const timer = setTimeout(() => commitSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search, initialSearch, commitSearch]);

  const searching = navigation.state === "loading";

  return (
    <div className="space-y-4">
      <div className="relative">
        <TextInput
          name="search"
          aria-label="Search customers"
          value={search}
          onChange={setSearch}
          inputProps={{
            placeholder: "Search by name or phone",
            autoComplete: "off",
            // 44px: this is the field a collector taps standing up, one-handed.
            className: `${FIELD} min-h-11 pl-9`,
          }}
        />
        {searching ? (
          <LoaderCircle
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 my-auto animate-spin text-success"
          />
        ) : (
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 my-auto text-success"
          />
        )}
      </div>

      {customers.length === 0 ? (
        <p className="rounded-lg border-2 border-dashed border-border p-6 text-center text-sm text-muted">
          {search
            ? `Nothing matches “${search}”.`
            : "Search for the customer you are collecting from."}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border-2 border-border bg-surface">
          {customers.map((c) => (
            <li key={c.id}>
              {/* Whole row is the target, min 44px tall — this is used on a
                  phone, in the field, with one thumb. */}
              <Link
                to={`?customer=${c.id}`}
                preventScrollReset
                className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-background"
              >
                <span className="font-medium text-foreground">
                  {c.fullName}
                </span>
                <span className="text-sm text-muted">{c.phone}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Step two: the money. */
function CollectPanel({
  customer,
  accounts,
  idempotencyKey,
  fieldErrors,
  requiredAmount,
}: {
  customer: { id: string; fullName: string };
  accounts: SusuAccount[];
  idempotencyKey: string;
  fieldErrors?: Record<string, string>;
  requiredAmount?: number;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const expected = collectAllTotal(accounts);

  /**
   * Prefilled with the exact total the API expects, because a collector adding
   * up three daily amounts in their head at a customer's door is how mismatches
   * happen. Editable, since the field is also the place a wrong total gets
   * corrected — and re-seeded from `requiredAmount` when the API says the total
   * moved under us (an account opened or closed since this page loaded).
   */
  const [amount, setAmount] = useState(() => toAmountInput(expected));
  const [seenRequired, setSeenRequired] = useState(requiredAmount);
  if (requiredAmount !== undefined && requiredAmount !== seenRequired) {
    setSeenRequired(requiredAmount);
    setAmount(toAmountInput(requiredAmount));
  }

  if (accounts.length === 0) {
    return (
      <div className="space-y-4">
        <ChangeCustomer name={customer.fullName} />
        <div className="rounded-2xl border-2 border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted">
            {customer.fullName} has no active susu account.
          </p>
          <Link
            to={`/customers/${customer.id}`}
            className="mt-2 inline-block text-sm text-success underline"
          >
            Open one on their profile
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ChangeCustomer name={customer.fullName} />

      <Form
        method="post"
        className="space-y-5 rounded-2xl border-2 border-border bg-surface p-5"
      >
        <input type="hidden" name="customerId" value={customer.id} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        {/* What the one amount is actually made of. Shown before the field, not
            after it: the collector reads this out, then takes the cash. */}
        <ul className="space-y-2">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <Link
                to={`/susu/${account.id}`}
                className="text-muted underline hover:text-foreground"
              >
                {formatGhs(account.dailyAmount)} daily
              </Link>
              <span className="tabular-nums text-muted">
                day {account.depositsCount + 1} of {account.cycleTarget}
              </span>
            </li>
          ))}
        </ul>

        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-4">
          <span className="text-sm font-medium text-foreground">
            One day, all {accounts.length}{" "}
            {accounts.length === 1 ? "account" : "accounts"}
          </span>
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {formatGhs(expected)}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <TextInput
              name="amount"
              label="Amount collected"
              value={amount}
              onChange={setAmount}
              inputProps={{
                // `decimal`, not `numeric`: the pesewas need a decimal point on
                // a phone keypad.
                inputMode: "decimal",
                autoComplete: "off",
                className: `${FIELD} min-h-11`,
              }}
            />
            <FieldError message={fieldErrors?.amount} />
          </div>

          <SelectField
            name="channel"
            label="Channel"
            defaultValue="cash"
            options={DEPOSIT_CHANNELS.map((channel) => ({
              value: channel,
              label: DEPOSIT_CHANNEL_LABELS[channel],
            }))}
          />
        </div>

        <p className="flex gap-2 text-xs text-muted">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            All or nothing — either every account gets its day or none does. The
            customer gets one itemised SMS receipt.
          </span>
        </p>

        <Button
          type="submit"
          size="lg"
          className="min-h-12 w-full rounded-md bg-success"
          isDisabled={submitting}
        >
          <HandCoins size={16} />
          {submitting ? "Collecting…" : `Collect ${formatGhs(expected)}`}
        </Button>
      </Form>
    </div>
  );
}

function ChangeCustomer({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="font-heading text-lg font-semibold text-foreground">
        {name}
      </p>
      <Link
        to="/collections"
        className="flex items-center gap-1 text-sm text-muted underline hover:text-foreground"
      >
        <ArrowLeft size={14} aria-hidden="true" />
        Change
      </Link>
    </div>
  );
}
