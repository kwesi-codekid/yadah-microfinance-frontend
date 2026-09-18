import {
  ArrowRightIcon,
  BanknoteArrowDownIcon,
  CheckIcon,
  CoinsIcon,
  LandmarkIcon,
  Loader2Icon,
  ReceiptTextIcon,
  TriangleAlertIcon,
  WalletIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  data,
  Form,
  useActionData,
  useNavigate,
  useNavigation,
  useSearchParams,
} from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { listAgreements } from "~/api/hire-purchase";
import { listLoans } from "~/api/loans";
import { listAccounts as listSavings } from "~/api/savings";
import { listAccounts as listSusu } from "~/api/susu";
import { createTransfer } from "~/api/transfers";
import { CustomerPicker, type PickedCustomer } from "~/components/customer-picker";
import { Figure } from "~/components/listing";
import { Page } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatAmount, formatPesewas, parseCedis, toCedisInput } from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import { WITHDRAWAL_FEE } from "~/lib/savings";
import { requireOffice, withAuth } from "~/lib/session.server";
import { commissionOf, payoutIfClosedNow } from "~/lib/susu";
import { redirectWithToast } from "~/lib/toast.server";
import {
  isSupportedRoute,
  splitAtCap,
  type TransferDestinationType,
  type TransferSourceType,
} from "~/lib/transfers";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/transfers";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Transfer · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = {
  title: "Transfer",
};

/**
 * One endpoint, and more rules behind it than any other in the API — so it gets
 * a whole page rather than a drawer. The screen's job is to make two things
 * unmistakable before anything is sent: **what leaves the source** (a savings
 * source is a real withdrawal and is charged for; a susu source stops the
 * account) and **what actually lands** (a loan or agreement takes at most what
 * it still owes, and the rest stays pending).
 *
 * The whole thing is driven by `?customerId=`. A transfer moves money between
 * two accounts of the same customer, so until one is chosen there is nothing to
 * show — and once one is chosen every side of the wizard is a fact about them,
 * loaded in one round trip rather than four as the steps are walked.
 */

/** A source or destination, flattened to what the wizard has to draw. */
interface Leg {
  id: string;
  kind: TransferDestinationType;
  /** What the branch calls it — an account number, or the item financed. */
  title: string;
  subtitle: string;
  /** Pesewas that would move, or that are still owed. */
  amount: number;
  /** Set on a susu source that is drawing down rather than closing. */
  pendingPayout?: boolean;
  /** Set on a susu source that would close: one day, kept by the house. */
  commission?: number;
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);

  const customerId = new URL(request.url).searchParams.get("customerId") ?? "";
  if (!customerId) {
    return data({ sources: [] as Leg[], destinations: [] as Leg[] });
  }

  const { data: legs, headers } = await withAuth(request, async (token) => {
    // Four books, one customer, one round trip. Walking the steps one fetch at
    // a time would make the wizard feel like it was thinking between clicks.
    const [susu, savings, loans, agreements] = await Promise.all([
      listSusu(token, { customerId, limit: 100 }),
      listSavings(token, { customerId, limit: 100 }),
      listLoans(token, { customerId, limit: 100 }),
      listAgreements(token, { customerId, limit: 100 }),
    ]);

    const sources: Leg[] = [];
    const destinations: Leg[] = [];

    for (const a of susu.items) {
      // Drawing down what a payout still owes is the one case in the whole
      // endpoint where a partial amount is allowed, so it is kept distinct
      // from an account that would be stopped to release its balance.
      if (a.status === "pending-payout" && a.payoutRemaining > 0) {
        sources.push({
          id: a.id,
          kind: "susu",
          title: `Susu ${a.accountNumber}`,
          // The number belongs to the customer, so two of their books read the
          // same here — and choosing one of these stops an account.
          subtitle: `Awaiting payout · ${a.ref}`,
          amount: a.payoutRemaining,
          pendingPayout: true,
        });
      } else if (
        (a.status === "active" || a.status === "completed") &&
        payoutIfClosedNow(a) > 0
      ) {
        sources.push({
          id: a.id,
          kind: "susu",
          title: `Susu ${a.accountNumber}`,
          subtitle: `${a.depositsCount} of ${a.cycleTarget} days paid in · ${a.ref}`,
          amount: payoutIfClosedNow(a),
          commission: commissionOf(a),
        });
      }
      if (a.status === "active") {
        destinations.push({
          id: a.id,
          kind: "susu",
          title: `Susu ${a.accountNumber}`,
          // Two active books at the same daily amount would otherwise render
          // an identical title AND subtitle, and this moves money.
          subtitle: `GH₵ ${formatAmount(a.dailyAmount)} a day · ${a.ref}`,
          amount: a.totalDeposited,
        });
      }
    }

    for (const a of savings.items) {
      if (a.status !== "active") continue;
      if (a.availableToWithdraw > 0) {
        sources.push({
          id: a.id,
          kind: "savings",
          title: `Savings ${a.accountNumber}`,
          subtitle: `GH₵ ${formatAmount(a.balance)} balance`,
          amount: a.availableToWithdraw,
        });
      }
      destinations.push({
        id: a.id,
        kind: "savings",
        title: `Savings ${a.accountNumber}`,
        subtitle: `GH₵ ${formatAmount(a.balance)} balance`,
        amount: a.balance,
      });
    }

    for (const l of loans.items) {
      if (l.status !== "active" && l.status !== "arrears") continue;
      if (l.remaining <= 0) continue;
      destinations.push({
        id: l.id,
        kind: "loan",
        title: `Loan · GH₵ ${formatAmount(l.principal)}`,
        subtitle: l.status === "arrears" ? "In arrears" : "Active",
        amount: l.remaining,
      });
    }

    for (const g of agreements.items) {
      if (g.status !== "active" && g.status !== "in-arrears") continue;
      if (g.remaining <= 0) continue;
      destinations.push({
        id: g.id,
        kind: "hire-purchase",
        title: g.item.name,
        subtitle: g.status === "in-arrears" ? "In arrears" : "Active",
        amount: g.remaining,
      });
    }

    return { sources, destinations };
  });

  return data(legs, { headers });
}

interface ActionResult {
  error: string;
  code?: string;
}

export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();

  const fromType = String(form.get("fromType") ?? "") as TransferSourceType;
  const fromId = String(form.get("fromId") ?? "");
  const toType = String(form.get("toType") ?? "") as TransferDestinationType;
  const toId = String(form.get("toId") ?? "");
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");
  const raw = String(form.get("amount") ?? "").trim();

  if (!fromId || !toId || !isSupportedRoute(fromType, toType)) {
    return data<ActionResult>(
      { error: "Pick where the money comes from and where it goes." },
      { status: 400 },
    );
  }

  // Omitted means the whole balance — a different instruction from any number,
  // so an empty box is passed through as absent rather than coerced to zero.
  const amount = raw === "" ? undefined : (parseCedis(raw) ?? undefined);
  if (raw !== "" && (amount == null || amount <= 0)) {
    return data<ActionResult>(
      { error: "Enter an amount, or leave it empty to move everything." },
      { status: 400 },
    );
  }

  const from =
    fromType === "susu"
      ? ({ type: "susu", accountId: fromId } as const)
      : ({ type: "savings", accountId: fromId } as const);

  const to =
    toType === "susu"
      ? ({ type: "susu", accountId: toId } as const)
      : toType === "savings"
        ? ({ type: "savings", accountId: toId } as const)
        : toType === "loan"
          ? ({ type: "loan", loanId: toId } as const)
          : ({ type: "hire-purchase", agreementId: toId } as const);

  let result: Awaited<ReturnType<typeof createTransfer>>;
  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ data: result, headers } = await withAuth(request, (token) =>
      createTransfer(token, { from, to, amount, idempotencyKey }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data<ActionResult>(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }

  const t = result.transfer;
  // The four figures the API actually settled on — not the preview's estimate.
  const parts = [`GH₵ ${formatAmount(t.amountCredited)} landed`];
  if (t.fee > 0) parts.push(`GH₵ ${formatAmount(t.fee)} fee`);
  if (t.excessPending > 0) {
    parts.push(`GH₵ ${formatAmount(t.excessPending)} left pending withdrawal`);
  }

  await redirectWithToast(
    "/transactions",
    {
      tone: "success",
      message: result.replayed
        ? "That transfer was already made."
        : `GH₵ ${formatAmount(t.amountMoved)} moved.`,
      description: `${parts.join(" · ")}. The customer has been sent an SMS.`,
    },
    headers,
  );
}

const KIND_ICON = {
  susu: CoinsIcon,
  savings: WalletIcon,
  loan: LandmarkIcon,
  "hire-purchase": ReceiptTextIcon,
} as const;

export default function Transfers({ loaderData }: Route.ComponentProps) {
  const { sources, destinations } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const submitting = navigation.state === "submitting";
  const loadingCustomer =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/transfers";

  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");

  // Minted once per visit. A double click or a retry after a dropped connection
  // has to carry the same key, or the money moves twice.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  const source = sources.find((s) => s.id === fromId) ?? null;
  const target = destinations.find((d) => d.id === toId) ?? null;

  // A source may never send to its own kind twice, and the destination cannot
  // be the account the money is leaving.
  const openTo = source
    ? destinations.filter(
        (d) =>
          d.id !== source.id &&
          isSupportedRoute(source.kind as TransferSourceType, d.kind),
      )
    : [];

  const partialAllowed = source?.pendingPayout === true;
  const typed = partialAllowed ? parseCedis(amount) : null;
  const whole = amount.trim() === "" || !partialAllowed;

  const preview = useMemo(() => {
    if (!source || !target) return null;
    const moved = whole ? source.amount : (typed ?? 0);
    if (moved <= 0) return null;
    // A savings source is a real withdrawal: the flat fee comes off on top of
    // what moves, exactly as it would at the counter.
    const fee = source.kind === "savings" ? WITHDRAWAL_FEE : 0;
    // Loans and agreements cap at what they still owe; a savings or susu
    // destination takes everything.
    const cap =
      target.kind === "loan" || target.kind === "hire-purchase"
        ? target.amount
        : null;
    const { credited, excess } = splitAtCap(moved, cap);
    return { moved, fee, credited, excess, leaves: moved + fee };
  }, [source, target, whole, typed]);

  const fault =
    partialAllowed && amount.trim() !== ""
      ? typed == null || typed <= 0
        ? "Enter an amount."
        : typed > source!.amount
          ? `Only GH₵ ${formatAmount(source!.amount)} is awaiting payout.`
          : null
      : null;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  // Picking a customer reloads the page against their accounts; clearing one
  // empties the wizard rather than leaving another customer's rows selected.
  const onPickCustomer = (next: PickedCustomer | null) => {
    setCustomer(next);
    setFromId("");
    setToId("");
    setAmount("");
    navigate(next ? `/transfers?customerId=${next.id}` : "/transfers", {
      replace: true,
    });
  };

  const picked = params.get("customerId") != null && customer != null;
  const nothingToMove = picked && !loadingCustomer && sources.length === 0;

  return (
    <Page>
      <Form method="post" className="space-y-4">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="fromType" value={source?.kind ?? ""} />
        <input type="hidden" name="fromId" value={source?.id ?? ""} />
        <input type="hidden" name="toType" value={target?.kind ?? ""} />
        <input type="hidden" name="toId" value={target?.id ?? ""} />

        {actionData?.error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            {actionData.error}
          </div>
        )}

        <Step n={1} title="Whose money" done={picked}>
          <CustomerPicker value={customer} onChange={onPickCustomer} autoFocus />
        </Step>

        <Step n={2} title="Where it comes from" done={source != null} muted={!picked}>
          {!picked ? (
            <Empty>Pick a customer first.</Empty>
          ) : loadingCustomer ? (
            <Empty>
              <Loader2Icon className="mr-2 inline size-3.5 animate-spin" />
              Reading their accounts…
            </Empty>
          ) : nothingToMove ? (
            <Empty>
              This customer has nothing that can be moved. A susu account has to
              hold more than one day&rsquo;s commission, and a savings account
              has to have more than the GH₵ 50 minimum and the GH₵ 10 fee left
              in it.
            </Empty>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {sources.map((leg) => (
                <LegCard
                  key={leg.id}
                  leg={leg}
                  selected={fromId === leg.id}
                  caption="would leave"
                  onSelect={() => {
                    setFromId(leg.id);
                    setToId("");
                    setAmount("");
                  }}
                />
              ))}
            </div>
          )}
          {source?.commission ? (
            <Note>
              Moving from this account <strong>stops it</strong>; one
              day&rsquo;s deposit (GH₵ {formatAmount(source.commission)}) is
              kept as commission.
            </Note>
          ) : null}
          {source?.pendingPayout ? (
            <Note>Awaiting payout, so a partial amount is accepted.</Note>
          ) : null}
          {source?.kind === "savings" ? (
            <Note>
              A withdrawal: the GH₵ {formatAmount(WITHDRAWAL_FEE)} fee applies
              and it uses today&rsquo;s one withdrawal.
            </Note>
          ) : null}
        </Step>

        <Step
          n={3}
          title="Where it goes"
          done={target != null}
          muted={source == null}
        >
          {source == null ? (
            <Empty>Pick where the money comes from first.</Empty>
          ) : openTo.length === 0 ? (
            <Empty>
              There is nowhere for this account to send to. A source may not
              send to another account of its own kind.
            </Empty>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {openTo.map((leg) => (
                <LegCard
                  key={leg.id}
                  leg={leg}
                  selected={toId === leg.id}
                  caption={
                    leg.kind === "loan" || leg.kind === "hire-purchase"
                      ? "still owing"
                      : "held now"
                  }
                  onSelect={() => setToId(leg.id)}
                />
              ))}
            </div>
          )}
        </Step>

        <Step
          n={4}
          title="How much"
          done={preview != null}
          muted={target == null}
        >
          {target == null ? (
            <Empty>Pick where the money goes first.</Empty>
          ) : (
            <div className="space-y-4">
              {partialAllowed ? (
                <div className="space-y-1.5">
                  <Label
                    htmlFor="amount"
                    className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
                  >
                    Amount · GH₵
                  </Label>
                  <Input
                    id="amount"
                    name="amount"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    placeholder={`${toCedisInput(source!.amount)} — everything`}
                    autoComplete="off"
                    aria-invalid={fault ? true : undefined}
                    className={cn("tabular", fault && "border-destructive")}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p
                      className={cn(
                        "text-xs",
                        fault ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {fault ??
                        (whole
                          ? "Empty moves the whole payout balance."
                          : `Leaves GH₵ ${formatAmount(source!.amount - (typed ?? 0))} awaiting payout.`)}
                    </p>
                    {!whole && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setAmount("")}
                      >
                        Move everything
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                // Not a disabled input: there is no number to give here, and a
                // greyed-out box would only invite someone to try.
                <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">
                  <BanknoteArrowDownIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <strong>The whole balance.</strong>{" "}
                    <span className="text-muted-foreground">
                      This route does not take a part-amount — the account is
                      emptied and closed in one move.
                    </span>
                  </span>
                </div>
              )}

              {preview && !fault && (
                <>
                  {/* Titles alone are not enough to confirm against: two susu
                      books of one customer share theirs, so the subtitle —
                      which carries the ref — comes with them. */}
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block font-medium">{source!.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {source!.subtitle}
                      </span>
                    </span>
                    <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block font-medium">{target.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {target.subtitle}
                      </span>
                    </span>
                  </div>
                  <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Figure
                      label="Leaves the source"
                      value={formatPesewas(preview.leaves)}
                      hint={
                        preview.fee > 0
                          ? `incl. GH₵ ${formatAmount(preview.fee)} fee`
                          : undefined
                      }
                      tone="warning"
                    />
                    <Figure label="Moves" value={formatPesewas(preview.moved)} />
                    <Figure
                      label="Lands"
                      value={formatPesewas(preview.credited)}
                      tone="success"
                    />
                    <Figure
                      label="Left pending"
                      value={formatPesewas(preview.excess)}
                      hint={
                        preview.excess > 0
                          ? "more than the balance owed"
                          : undefined
                      }
                      tone={preview.excess > 0 ? "info" : "muted"}
                    />
                  </dl>
                  {preview.excess > 0 && (
                    <Note>
                      {target.title} only owes GH₵ {formatAmount(target.amount)}.
                      The remaining GH₵ {formatAmount(preview.excess)} stays in
                      the susu account, pending withdrawal.
                    </Note>
                  )}
                </>
              )}
            </div>
          )}
        </Step>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="submit"
            size="lg"
            disabled={submitting || preview == null || Boolean(fault)}
          >
            {submitting && <Loader2Icon className="animate-spin" />}
            {preview
              ? `Move GH₵ ${formatAmount(preview.moved)}`
              : "Move the money"}
          </Button>
        </div>
      </Form>
    </Page>
  );
}

/* ------------------------------------------------------------------ pieces --- */

/**
 * One numbered step. The wizard stays on one page rather than paging between
 * screens: every rule here is about how two steps interact, and hiding the
 * source while the destination is chosen would hide half of each sentence.
 */
function Step({
  n,
  title,
  done,
  muted,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-4 transition-opacity sm:p-5",
        muted && "opacity-60",
      )}
    >
      <h3 className="mb-3 flex items-center gap-2.5 text-sm font-semibold">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            done
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {done ? <CheckIcon className="size-3.5" /> : n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function LegCard({
  leg,
  selected,
  caption,
  onSelect,
}: {
  leg: Leg;
  selected: boolean;
  caption: string;
  onSelect: () => void;
}) {
  const Icon = KIND_ICON[leg.kind];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border hover:border-foreground/20 hover:bg-muted/40",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{leg.title}</p>
        <p className="truncate text-xs text-muted-foreground">{leg.subtitle}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="tabular text-sm font-semibold">
          {formatPesewas(leg.amount)}
        </p>
        <p className="text-[11px] text-muted-foreground">{caption}</p>
      </div>
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      {children}
    </p>
  );
}
