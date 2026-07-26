import { useEffect, useRef, useState } from "react";
import {
  data,
  Form,
  Link,
  useNavigation,
  useSearchParams,
} from "react-router";
import { Button } from "@heroui/react";
import { Plus, WalletCards } from "lucide-react";
import type { Route } from "./+types/customer-accounts";
import {
  AccountCard,
  AccountCardSkeleton,
} from "~/components/account-card";
import { CollectionFooter, EmptyState } from "~/components/data-table";
import { FIELD, FieldError, FilterSelect } from "~/components/form-fields";
import { TextInput } from "~/components/inputs";
import { ConfirmModal } from "~/components/modals";
import { PageHeader } from "~/components/page-header";
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
  const status: SusuAccountStatus | undefined =
    selected === "all" ? undefined : selected;

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
      }),
    ]);
    return { customer: customer.customer, susu };
  }).catch(throwAsRouteError); // 404, or 403 for someone else's customer

  return data(
    {
      customer: result.customer,
      susu: result.susu,
      filters: { page, limit, status: selected },
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
  const { customer, susu, filters, canManage } = loaderData;
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();

  const pageCount = Math.max(1, Math.ceil(susu.total / susu.limit));
  const loading = navigation.state === "loading";

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
      <PageHeader
        backTo="/customers"
        backLabel="Customers"
        title={customer.fullName}
        subtitle="Accounts"
        actions={
          canManage &&
          customer.status === "active" && (
            <OpenAccountButton
              // Remounts once the account exists, which clears the amount out
              // of the dialog. A rejected submit leaves the total unchanged, so
              // the typed value survives to be corrected.
              key={susu.total}
              error={actionData?.fieldErrors?.dailyAmount}
            />
          )
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          to={`/customers/${customer.id}`}
          className="text-sm text-muted underline hover:text-foreground"
        >
          Customer profile
        </Link>
        {canManage && customer.status !== "active" && (
          <span className="text-sm text-muted">
            Reactivate this customer to open an account.
          </span>
        )}
      </div>

      {/* Susu. The heading carries the product even with one section on the
          page — it is what makes room for savings read as a gap rather than an
          omission. */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold text-foreground">
              Susu
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Each account is one cycle of {SUSU_CYCLE_TARGET} days at a fixed
              daily amount.
            </p>
          </div>

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
                title:
                  filters.status === "active"
                    ? "No active susu account"
                    : "No susu accounts found",
                subtext:
                  filters.status === "active"
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
 * Open a cycle, from the page header.
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
        className="min-h-6 rounded-md bg-success"
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
