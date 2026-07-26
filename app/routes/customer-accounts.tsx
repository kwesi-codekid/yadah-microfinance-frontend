import { useCallback, useEffect, useRef, useState } from "react";
import {
  data,
  Form,
  useNavigation,
  useNavigationType,
  useSearchParams,
} from "react-router";
import { Button } from "@heroui/react";
import { LoaderCircle, Plus, Search, WalletCards, X } from "lucide-react";
import type { Route } from "./+types/customer-accounts";
import {
  AccountCard,
  AccountCardSkeleton,
} from "~/components/account-card";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { CollectionFooter, EmptyState } from "~/components/data-table";
import { FIELD, FieldError, FilterSelect } from "~/components/form-fields";
import { TextInput } from "~/components/inputs";
import { ConfirmModal } from "~/components/modals";
import { notify } from "~/components/toast";
import {
  throwAsRouteError,
  toApiFailure,
  type ApiFailure,
} from "~/lib/api/client";
import * as customersApi from "~/lib/api/customers";
import * as susuApi from "~/lib/api/susu";
import { formatGhs, parseGhsAmount } from "~/lib/money";
import {
  isSusuAccountStatus,
  SUSU_CYCLE_TARGET,
  type SusuAccountStatus,
} from "~/lib/susu-client";
import { readOpenAccountForm } from "~/lib/susu-form";
import { isOffice, requireUser, withAuth } from "~/lib/session.server";

/**
 * Everything one customer is saving into, in one place.
 *
 * This is where an account is reached from — there is no cross-customer ledger
 * page. A susu cycle runs 31 days and a customer opens a fresh one about every
 * month (sometimes several at once, at different daily amounts), so this list
 * grows without limit and is paged and filtered by status rather than shown
 * whole. Active is the working set; the rest are history you go looking for.
 *
 * One page rather than a product picker in front of it: "which product?" is a
 * heading, not a screen. Savings drops in as a second section below susu when
 * its endpoints are wired — nothing is rendered for it now, because a section
 * saying "not available" advertises a feature that isn't there.
 */

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
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  const limit = Math.max(1, Number(sp.get("limit") || "20") || 20);
  // "All" is a real choice: the API returns every status when the filter is
  // omitted, so the four options here are active/completed/closed/all.
  const statusParam = sp.get("status");
  const selected =
    isSusuAccountStatus(statusParam) || statusParam === "all"
      ? statusParam
      : "active";

  /**
   * The number printed on the customer's card — six digits, exactly.
   *
   * Digits only and truncated here rather than trusted: the field is the one
   * place a counter types, and `?accountNumber=abc` is a URL anyone can hand
   * over. A partial number is dropped instead of sent, because the API matches
   * the whole number and a prefix would come back as "no such account" when
   * the truth is "keep typing".
   */
  const typed = (sp.get("accountNumber") ?? "").replace(/\D/g, "").slice(0, 6);
  const accountNumber = typed.length === 6 ? typed : undefined;

  /**
   * A number search ignores the status filter.
   *
   * Someone reading a number off a card doesn't know whether that cycle is
   * still running, and an empty page for an account that plainly exists is the
   * worst answer this screen can give. The filter is what you browse with; the
   * number is what you look up.
   */
  const status: SusuAccountStatus | undefined =
    accountNumber || selected === "all" ? undefined : selected;

  const { data: result, headers } = await withAuth(request, async (token) => {
    // The customer is fetched for their name and status, not decoration: an
    // inactive customer can't be given an account (422 CUSTOMER_INACTIVE), so
    // the button is withheld rather than offered and refused.
    const [customer, susu] = await Promise.all([
      customersApi.getCustomer(token, params.id),
      susuApi.listSusuAccounts(token, {
        customerId: params.id,
        page,
        limit,
        status,
        // Scoped to this customer either way: a number belonging to someone
        // else returns nothing here rather than another person's account.
        accountNumber,
      }),
    ]);
    return { customer: customer.customer, susu };
  }).catch(throwAsRouteError); // 404, or 403 for someone else's customer

  return data(
    {
      customer: result.customer,
      susu: result.susu,
      // `typed` rather than `accountNumber`: the field is seeded from this, and
      // a half-typed number has to survive a reload the same as a whole one.
      filters: { page, limit, status: selected, accountNumber: typed },
      /** Whether the six digits actually narrowed the list. */
      searchingNumber: accountNumber !== undefined,
      canManage: office,
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

  if (intent !== "open-susu") {
    return data<ActionData>({ intent, formError: "Unsupported action." });
  }

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
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const failure = toApiFailure(error);
    return data<ActionData>({
      intent,
      formError: failure.message,
      failure,
    });
  }
}

export default function CustomerAccounts({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { customer, susu, filters, searchingNumber, canManage } = loaderData;
  const navigation = useNavigation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();

  const pageCount = Math.max(1, Math.ceil(susu.total / susu.limit));
  const loading = navigation.state === "loading";

  // The field types against local state; the URL (and so the loader) catches
  // up on a debounce. Seeded from the URL so a shared or reloaded link shows
  // the number it filtered by.
  const [number, setNumber] = useState(filters.accountNumber);
  /** Typed, but not yet the whole number — nothing has been sent. */
  const partial = number.length > 0 && number.length < 6;

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
  // actually use: six digits, or empty to clear.
  useEffect(() => {
    if (number === filters.accountNumber) return;
    if (number.length > 0 && number.length < 6) return;
    const timer = setTimeout(() => commitNumber(number), 300);
    return () => clearTimeout(timer);
  }, [number, filters.accountNumber, commitNumber]);

  // Back/forward moves the URL out from under the field, so adopt it. Our own
  // updates above are REPLACE navigations, which never land here.
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
      {/* No page heading and no section heading: the cards carry the product
          on their own faces. The trail does the work the heading used to —
          whose accounts these are, and the way back up to them — in one line
          instead of a block. */}
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
            it, and centring would drop the filter and the button half a line
            below the input they sit beside. */}
        <div className="mb-4 flex flex-wrap items-start gap-3">
          {/* A real GET form, so the field and the filter still work with
              JavaScript off — each carries the `name` the loader reads. The
              Open account button stays outside it: it posts, and a form inside
              a form is neither valid nor submittable. */}
          <Form
            method="get"
            className="flex flex-1 flex-wrap items-start gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              // Enter searches now rather than waiting out the debounce.
              if (!partial) commitNumber(number);
            }}
          >
            <div className="w-full max-w-60">
              <div className="relative">
                <TextInput
                  name="accountNumber"
                  aria-label="Search by account number"
                  value={number}
                  // Digits only, six at most — the field can't be made to hold
                  // something the API would reject.
                  onChange={(value) =>
                    setNumber(value.replace(/\D/g, "").slice(0, 6))
                  }
                  inputProps={{
                    // `numeric` so a phone offers a keypad, not a keyboard.
                    inputMode: "numeric",
                    autoComplete: "off",
                    maxLength: 6,
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
              {/* Said once, where it applies: six digits or nothing, and the
                  filter steps aside for a number. */}
              <p className="mt-1 text-xs text-muted">
                {partial
                  ? `${6 - number.length} more ${6 - number.length === 1 ? "digit" : "digits"} to search.`
                  : searchingNumber
                    ? "Searching every status."
                    : "Six digits, from the customer's card."}
              </p>
            </div>

            <div className="ml-auto">
              <FilterSelect
                name="status"
                label="Filter by status"
                value={filters.status}
                onChange={(value) => setParam({ status: value, page: null })}
                options={[
                  { value: "active", label: "Active accounts" },
                  { value: "completed", label: "Completed accounts" },
                  { value: "closed", label: "Closed accounts" },
                  { value: "all", label: "All accounts" },
                ]}
              />
            </div>
          </Form>

          {/* The button moves down here with the heading gone — the filter and
              the one action that changes this list sit on the same rule. */}
          {canManage && customer.status === "active" && (
            <OpenAccountButton
              // Remounts once the account exists, which clears the amount out
              // of the dialog. A rejected submit leaves the total unchanged, so
              // the typed value survives to be corrected.
              key={susu.total}
              error={actionData?.fieldErrors?.dailyAmount}
            />
          )}
        </div>

        {canManage && customer.status !== "active" && (
          <p className="mb-4 text-sm text-muted">
            Reactivate this customer to open an account.
          </p>
        )}

        {/* Cards, not rows: an account has four facts worth reading and a
            shape everyone already knows how to hold. The grid fills to the
            width it's given rather than fixing a column count — one card on a
            phone, four on a monitor, and the cards keep their proportions. */}
        {loading ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-4">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i}>
                <AccountCardSkeleton />
              </li>
            ))}
          </ul>
        ) : susu.items.length === 0 ? (
          <div className="rounded-2xl border-2 border-border bg-surface">
            <EmptyState
              content={{
                icon: <WalletCards size={64} strokeWidth={1.5} />,
                // A number that found nothing is its own answer: the filter
                // wasn't what hid it, so don't send anyone to change it.
                title: searchingNumber
                  ? `No account ${filters.accountNumber}`
                  : filters.status === "active"
                    ? "No active susu account"
                    : "No susu accounts found",
                subtext: searchingNumber
                  ? `${customer.fullName} holds no account with that number. Check the digits, or clear the search.`
                  : filters.status === "active"
                    ? "Open one to start a 31-day cycle — or switch the filter to see finished ones."
                    : "Nothing matches this filter.",
              }}
            />
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-4">
            {susu.items.map((account) => (
              <li key={account.id}>
                <AccountCard account={account} />
              </li>
            ))}
          </ul>
        )}

        {susu.items.length > 0 && (
          <div className="mt-6">
            <CollectionFooter
              page={susu.page}
              pageCount={pageCount}
              onPageChange={(p) => setParam({ page: String(p) })}
              pageSize={susu.limit}
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
 * Open a cycle, from the bar above the list.
 *
 * The daily amount is fixed for the life of the cycle — the only way to change
 * it is to close the account and open another — so the dialog does double duty:
 * it takes the amount and, as you type, states what it commits to. Reading back
 * `GHS 50,000.00` is what catches the missing decimal point; a ceiling invented
 * here would eventually refuse an account the API would have allowed.
 */
function OpenAccountButton({ error }: { error?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const pesewas = parseGhsAmount(amount);
  const valid = pesewas !== null && pesewas >= 1;

  // A rejected submit has to bring the dialog back, or the message lands on a
  // field that is no longer on screen. Adjusted during render rather than in an
  // effect, so there is no pass with the error set and the dialog still closed.
  const [seenError, setSeenError] = useState(error);
  if (error !== seenError) {
    setSeenError(error);
    if (error) setOpen(true);
  }

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

      {/* The dialog renders in a portal, so the field inside it can't sit in
          this form. It posts the same state through a hidden input instead —
          which is also what lets the footer button submit from outside. */}
      <Form method="post" ref={formRef} className="hidden">
        <input type="hidden" name="intent" value="open-susu" />
        <input type="hidden" name="dailyAmount" value={amount} />
      </Form>

      <ConfirmModal
        isOpen={open}
        onOpenChange={setOpen}
        title="Open a susu account"
        closeLabel="Cancel"
        footer={
          <Button
            size="sm"
            className="rounded-md bg-success"
            isDisabled={!valid}
            onPress={() => {
              setOpen(false);
              formRef.current?.requestSubmit();
            }}
          >
            Open account
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <TextInput
              label="Daily amount"
              value={amount}
              onChange={setAmount}
              autoFocus
              inputProps={{
                // `decimal` so a phone keypad offers the point for pesewas.
                inputMode: "decimal",
                autoComplete: "off",
                placeholder: "5.00",
                className: `${FIELD} min-h-11`,
              }}
            />
            <FieldError message={error} />
          </div>

          <div className="space-y-3 text-sm text-muted">
            {/* Only once there is an amount to talk about — a sentence full of
                GHS 0.00 before anyone has typed is noise. */}
            {valid && (
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
            )}
            <p>
              The daily amount can't be changed afterwards. To save a different
              amount, this account has to be closed and a new one opened — and
              one day's deposit is kept as commission when it closes.
            </p>
          </div>
        </div>
      </ConfirmModal>
    </>
  );
}
