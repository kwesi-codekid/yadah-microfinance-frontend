import { CheckIcon, Loader2Icon, ReceiptIcon, WalletIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { listCashAccounts } from "~/api/accounting";
import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import {
  approveExpense,
  attachReceipt,
  getExpense,
  payExpense,
  rejectExpense,
} from "~/api/expenses";
import { Figure, StatusPill } from "~/components/listing";
import { BackLink, Page } from "~/components/page";
import { IDLE, ScanDrop, type Slot } from "~/components/scan-drop";
import { Button } from "~/components/ui/button";
import { DateField } from "~/components/ui/date-field";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { canApproveBy, canDecide, canPay } from "~/lib/accounting";
import { isOffice } from "~/lib/auth";
import { accraDay, formatAccraDate, formatAccraDateTime, formatPesewas } from "~/lib/format";
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_STATUS_BLURBS,
  EXPENSE_STATUS_LABELS,
  EXPENSE_STATUS_TONE,
  WRITE_OFF_LABELS,
} from "~/lib/expenses";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/expense";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `${loaderData?.expense.description ?? "Expense"} · Expenses · Yadah Dynamic Enterprise`,
    },
  ];
}

/** What the layout header calls this page. */
export const handle = { title: "Expense" };

/**
 * One cost, and what happens to it next.
 *
 * The three things the office can do here are deliberately separate: approving
 * makes it a liability, paying moves the cash, and rejecting does neither. A
 * single "settle" button would hide the difference, and the difference is the
 * whole reason the cash position can be trusted.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireCounter(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const [expense, accounts] = await Promise.all([
        getExpense(token, params.id),
        // Only needed to pay, but fetching it here keeps the button from
        // opening onto an empty select.
        listCashAccounts(token).catch(() => []),
      ]);
      return { expense: expense.expense, accounts };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data(
    {
      expense: result.expense,
      accounts: result.accounts,
      viewerId: viewer.id,
      canDecideHere: isOffice(viewer),
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "receipt") {
      const receiptUrl = String(form.get("receiptUrl") ?? "").trim();
      if (!receiptUrl) return data({ error: "No receipt was uploaded." }, { status: 400 });
      const { headers } = await withAuth(request, (token) =>
        attachReceipt(token, params.id, receiptUrl),
      );
      await redirectWithToast(
        `/expenses/${params.id}`,
        { tone: "success", message: "Receipt attached." },
        headers,
      );
      return null;
    }

    if (intent === "approve") {
      const { headers } = await withAuth(request, (token) => approveExpense(token, params.id));
      await redirectWithToast(
        `/expenses/${params.id}`,
        {
          tone: "success",
          message: "Approved.",
          description: "It is a liability until it is paid. No cash has moved.",
        },
        headers,
      );
      return null;
    }

    if (intent === "reject") {
      const reason = String(form.get("reason") ?? "").trim();
      if (reason.length < 3) {
        return data({ error: "Say why — the person who recorded it sees this." }, { status: 400 });
      }
      const { headers } = await withAuth(request, (token) =>
        rejectExpense(token, params.id, reason),
      );
      await redirectWithToast(
        "/expenses",
        { tone: "success", message: "Rejected. Nothing moved and nothing is owed." },
        headers,
      );
      return null;
    }

    if (intent === "pay") {
      const cashAccountId = String(form.get("cashAccountId") ?? "").trim();
      const paidOn = String(form.get("paidOn") ?? "").trim();
      if (!cashAccountId) {
        return data({ error: "Choose the account the money left." }, { status: 400 });
      }
      const { data: result, headers } = await withAuth(request, (token) =>
        payExpense(token, params.id, {
          cashAccountId,
          ...(paidOn ? { paidOn } : {}),
        }),
      );
      await redirectWithToast(
        `/expenses/${params.id}`,
        {
          tone: "success",
          message: `${formatPesewas(result.expense.amount)} paid.`,
          description: "The cash position has moved.",
        },
        headers,
      );
      return null;
    }

    return data({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export default function ExpenseDetail({ loaderData }: Route.ComponentProps) {
  const { expense, accounts, viewerId, canDecideHere } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [rejecting, setRejecting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<Slot>(IDLE);

  const decidable = canDecide(expense);
  const approvable = canApproveBy(expense, viewerId);
  const payable = canPay(expense);

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <Page>
      <BackLink to="/expenses" className="mb-4">
        All expenses
      </BackLink>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">{expense.description}</h2>
          <StatusPill
            tone={EXPENSE_STATUS_TONE[expense.status]}
            label={EXPENSE_STATUS_LABELS[expense.status]}
            blurb={EXPENSE_STATUS_BLURBS[expense.status]}
          />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {EXPENSE_CATEGORY_LABELS[expense.category]}
          {expense.payee ? ` · ${expense.payee}` : ""} ·{" "}
          {formatAccraDate(expense.incurredOn)}
          {expense.reference ? ` · ${expense.reference}` : ""}
        </p>
      </header>

      <dl className="mb-6 grid gap-3 sm:grid-cols-3">
        <Figure
          label="Amount"
          value={formatPesewas(expense.amount)}
          hint={EXPENSE_STATUS_BLURBS[expense.status]}
          tone={expense.status === "paid" ? "success" : "warning"}
        />
        <Figure
          label="Recorded by"
          value={expense.recordedByName ?? "Staff"}
          hint={formatAccraDateTime(expense.createdAt)}
          tone="muted"
        />
        <Figure
          label={expense.status === "rejected" ? "Rejected by" : "Approved by"}
          value={expense.approvedByName ?? "—"}
          hint={
            expense.paidOn
              ? `Paid ${formatAccraDate(expense.paidOn)}`
              : expense.approvedByName
                ? "Not yet paid"
                : "Not yet approved"
          }
          tone="muted"
        />
      </dl>

      {expense.rejectionReason && (
        <section className="mb-6 rounded-xl border border-border bg-card p-4 sm:p-5">
          <h3 className="mb-2 text-sm font-semibold">Why it was refused</h3>
          <p className="text-sm text-muted-foreground">{expense.rejectionReason}</p>
        </section>
      )}

      {expense.writeOffEntityType && (
        <p className="mb-6 text-sm text-muted-foreground">
          Writing off a {WRITE_OFF_LABELS[expense.writeOffEntityType].toLowerCase()}.
        </p>
      )}

      {/* The receipt. Attachable at any status: one turning up after approval
          is the ordinary case, and a record is not worse for being late. */}
      <section className="mb-6 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-semibold">Receipt</h3>
        {expense.receiptUrl ? (
          <a
            href={expense.receiptUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block overflow-hidden rounded-lg border border-border"
          >
            <img
              src={expense.receiptUrl}
              alt="The receipt for this expense"
              className="h-48 w-auto object-cover"
            />
          </a>
        ) : (
          <Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="receipt" />
            <input type="hidden" name="receiptUrl" value={receipt.url ?? ""} />
            <ScanDrop
              label="Photograph the receipt"
              kind="document"
              slot={receipt}
              onChange={setReceipt}
              captureTitle="Photograph the receipt"
              frame="aspect-[3/4] w-full max-w-xs"
            />
            <Button type="submit" size="sm" disabled={submitting || receipt.status !== "done"}>
              {submitting && <Loader2Icon className="animate-spin" />}
              <ReceiptIcon />
              Attach receipt
            </Button>
          </Form>
        )}
      </section>

      {canDecideHere && (decidable || payable) && (
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <h3 className="text-sm font-semibold">
            {payable ? "Pay it" : "Approve or reject"}
          </h3>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            {payable
              ? "Paying is the only step that moves money, which is why it is the only one that names an account."
              : "Approving makes it a liability on the balance sheet. Cash does not move until it is paid."}
          </p>

          {payable ? (
            paying ? (
              <Form method="post" className="space-y-3">
                <input type="hidden" name="intent" value="pay" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cashAccountId" className="eyebrow text-muted-foreground">
                      Paid from<span className="ml-0.5 text-destructive">*</span>
                    </Label>
                    <Select name="cashAccountId">
                      <SelectTrigger id="cashAccountId" className="w-full">
                        <SelectValue placeholder="Which account" />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="eyebrow text-muted-foreground">Paid on</Label>
                    <DateField name="paidOn" defaultValue={accraDay()} endMonth={new Date()} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="submit" disabled={submitting}>
                    {submitting && <Loader2Icon className="animate-spin" />}
                    Pay {formatPesewas(expense.amount)}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setPaying(false)}>
                    Cancel
                  </Button>
                </div>
              </Form>
            ) : (
              <Button type="button" onClick={() => setPaying(true)}>
                <WalletIcon />
                Pay {formatPesewas(expense.amount)}
              </Button>
            )
          ) : rejecting ? (
            <Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="reject" />
              <div className="space-y-1.5">
                <Label htmlFor="reason" className="eyebrow text-muted-foreground">
                  Why<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Textarea
                  id="reason"
                  name="reason"
                  rows={3}
                  maxLength={300}
                  autoFocus
                  placeholder="Personal, not a branch cost."
                />
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" variant="destructive" disabled={submitting}>
                  {submitting && <Loader2Icon className="animate-spin" />}
                  Reject expense
                </Button>
                <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
              </div>
            </Form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Form method="post">
                <input type="hidden" name="intent" value="approve" />
                <Button type="submit" disabled={submitting || !approvable}>
                  {submitting ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
                  Approve
                </Button>
              </Form>
              <Button type="button" variant="outline" onClick={() => setRejecting(true)}>
                <XIcon />
                Reject
              </Button>
              {!approvable && (
                // Said before the click rather than after: the API refuses it,
                // and a disabled button with no reason is just a dead end.
                <p className="text-xs text-muted-foreground">
                  You recorded this one — somebody else in the office has to
                  approve it.
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </Page>
  );
}
