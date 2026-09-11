import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { recordExpense } from "~/api/accounting";
import { ApiError } from "~/api/error";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { DateField } from "~/components/ui/date-field";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_OPTIONS,
  WRITE_OFF_LABELS,
  type ExpenseCategory,
  type WriteOffEntityType,
} from "~/lib/accounting";
import { accraDay, formatPesewas, parseCedis } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/accounting-expense-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Record an expense · Yadah Dynamic Enterprise" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  return null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WRITE_OFF_TYPES: WriteOffEntityType[] = ["loan", "hp-agreement"];

/**
 * `POST /accounting/expenses` — record a cost. Office.
 *
 * Recording moves no money: the expense waits for someone other than the
 * recorder to approve it, and only paying names an account. `incurredOn` is
 * the day the cost belongs to, which is not always the day it is paid.
 */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const category = String(form.get("category") ?? "") as ExpenseCategory;
  const description = String(form.get("description") ?? "").trim();
  const amount = parseCedis(String(form.get("amount") ?? "").trim());
  const payee = String(form.get("payee") ?? "").trim();
  const incurredOn = String(form.get("incurredOn") ?? "").trim();
  const reference = String(form.get("reference") ?? "").trim();
  const receiptUrl = String(form.get("receiptUrl") ?? "").trim();
  const writeOffEntityType = String(form.get("writeOffEntityType") ?? "") as
    | WriteOffEntityType
    | "";
  const writeOffEntityId = String(form.get("writeOffEntityId") ?? "").trim();

  if (!EXPENSE_CATEGORIES.includes(category)) {
    return data({ error: "Pick a category." }, { status: 400 });
  }
  if (!description) {
    return data({ error: "Say what the money was for." }, { status: 400 });
  }
  if (amount == null || amount < 1) {
    return data({ error: "Enter the amount." }, { status: 400 });
  }
  if (!DAY_RE.test(incurredOn)) {
    return data({ error: "Pick the day the cost belongs to." }, { status: 400 });
  }
  if (incurredOn > accraDay()) {
    return data({ error: "A cost cannot belong to a day that has not happened." }, { status: 400 });
  }
  if (receiptUrl && !/^https?:\/\//.test(receiptUrl)) {
    return data({ error: "The receipt link has to be a full web address." }, { status: 400 });
  }
  const writingOff = category === "bad-debt-recovery" && writeOffEntityType !== "";
  if (writingOff && !WRITE_OFF_TYPES.includes(writeOffEntityType as WriteOffEntityType)) {
    return data({ error: "Say what is being written off." }, { status: 400 });
  }
  if (writingOff && !writeOffEntityId) {
    return data({ error: "Give the id of what is being written off." }, { status: 400 });
  }

  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ headers } = await withAuth(request, (token) =>
      recordExpense(token, {
        category,
        description,
        amount,
        payee: payee || undefined,
        incurredOn,
        reference: reference || undefined,
        receiptUrl: receiptUrl || undefined,
        ...(writingOff
          ? {
              writeOffEntityType: writeOffEntityType as WriteOffEntityType,
              writeOffEntityId,
            }
          : {}),
      }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  await redirectWithToast(
    "/accounting/expenses",
    {
      tone: "success",
      message: `${formatPesewas(amount)} recorded.`,
      description: "It waits for someone else to approve it before it can be paid.",
    },
    headers,
  );
}

export default function AccountingExpenseNew() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [category, setCategory] = useState<ExpenseCategory>("petty-cash-office");
  const [writeOffType, setWriteOffType] = useState<WriteOffEntityType | "">("");
  const writingOff = category === "bad-debt-recovery";

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo="/accounting/expenses"
      title="Record an expense"
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {actionData?.error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <p className="font-medium">{actionData.error}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="category" className="eyebrow text-muted-foreground">
              Category<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select
              name="category"
              value={category}
              onValueChange={(v) => setCategory(v as ExpenseCategory)}
            >
              <SelectTrigger id="category" className="w-full">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description" className="eyebrow text-muted-foreground">
              What for<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="description"
              name="description"
              autoFocus
              autoComplete="off"
              maxLength={200}
              placeholder="August electricity, head office"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="amount" className="eyebrow text-muted-foreground">
                Amount · GH₵<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="amount"
                name="amount"
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                className="tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="incurredOn" className="eyebrow text-muted-foreground">
                Incurred on<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <DateField
                id="incurredOn"
                name="incurredOn"
                defaultValue={accraDay()}
                endMonth={new Date()}
                required
              />
            </div>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            The day the cost belongs to, not the day it is paid. August salaries
            settled in September are an August cost.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="payee" className="eyebrow text-muted-foreground">
                Paid to
              </Label>
              <Input id="payee" name="payee" autoComplete="off" maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reference" className="eyebrow text-muted-foreground">
                Reference
              </Label>
              <Input
                id="reference"
                name="reference"
                autoComplete="off"
                maxLength={80}
                placeholder="Invoice or bill number"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="receiptUrl" className="eyebrow text-muted-foreground">
              Receipt link
            </Label>
            <Input
              id="receiptUrl"
              name="receiptUrl"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://"
            />
          </div>

          {/* A bad-debt write-off names what it is writing off, so the cost can
              be read back against the loan or agreement it belongs to. */}
          {writingOff && (
            <div className="space-y-4 rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-sm font-medium">What is being written off?</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="writeOffEntityType" className="eyebrow text-muted-foreground">
                    Kind
                  </Label>
                  <Select
                    name="writeOffEntityType"
                    value={writeOffType}
                    onValueChange={(v) => setWriteOffType(v as WriteOffEntityType)}
                  >
                    <SelectTrigger id="writeOffEntityType" className="w-full">
                      <SelectValue placeholder="Not tied to a record" />
                    </SelectTrigger>
                    <SelectContent>
                      {WRITE_OFF_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {WRITE_OFF_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="writeOffEntityId" className="eyebrow text-muted-foreground">
                    Record id
                  </Label>
                  <Input
                    id="writeOffEntityId"
                    name="writeOffEntityId"
                    autoComplete="off"
                    disabled={!writeOffType}
                    className="tabular"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="note" className="sr-only">
              Note
            </Label>
            <Textarea id="note" name="note" rows={1} className="hidden" tabIndex={-1} />
          </div>
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2Icon className="animate-spin" />}
            Record expense
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
