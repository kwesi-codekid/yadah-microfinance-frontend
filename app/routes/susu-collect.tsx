import { HandCoinsIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { collectAll, listAccounts } from "~/api/susu";
import { CustomerPicker, type PickedCustomer } from "~/components/customer-picker";
import { RouteSheet, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { formatAmount, parseCedis, toCedisInput } from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import { requireUser, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { CHANNEL_OPTIONS, type DepositChannel } from "~/lib/susu";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/susu-collect";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Collect all · Yadah Dynamic Enterprise" }];
}

/**
 * One day's cash into every active account a customer holds, in a single
 * all-or-nothing move. Collectors do this on the round, so it is open to every
 * signed-in role, exactly as the API has it.
 *
 * The customer may arrive on the query string — the listing's row menu offers
 * "Collect all for them" — in which case their accounts are pre-read so the
 * required total can be shown before anything is typed.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  const customerId = new URL(request.url).searchParams.get("customerId")?.trim();
  if (!customerId) return { preset: null };

  const { data: result, headers } = await withAuth(request, (token) =>
    listAccounts(token, { customerId, status: "active", limit: 100 }),
  );

  const accounts = result.items.map((a) => ({
    id: a.id,
    accountNumber: a.accountNumber,
    dailyAmount: a.dailyAmount,
  }));

  return data(
    {
      preset: {
        customer: {
          id: customerId,
          fullName: result.items[0]?.customerName ?? "This customer",
          phone: "",
        },
        accounts,
        required: accounts.reduce((sum, a) => sum + a.dailyAmount, 0),
      },
    },
    { headers },
  );
}

/** The `{ required, breakdown }` an `AMOUNT_MISMATCH` carries. */
interface Mismatch {
  required?: number;
  breakdown?: { accountNumber?: string; dailyAmount?: number }[];
}

export async function action({ request }: Route.ActionArgs) {
  await requireUser(request);
  const form = await request.formData();
  const customerId = String(form.get("customerId") ?? "").trim();
  const amount = parseCedis(String(form.get("amount") ?? ""));
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");
  const channel = String(form.get("channel") ?? "cash") as DepositChannel;

  if (!customerId) {
    return data({ error: "Choose the customer paying in." }, { status: 400 });
  }
  if (amount == null || amount <= 0) {
    return data({ error: "Enter the cash received." }, { status: 400 });
  }
  if (idempotencyKey.length < 8) {
    return data({ error: "Reload the page and try again." }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      collectAll(token, { customerId, amount, idempotencyKey, channel }),
    );
    // A replay means the round already went through — say so rather than
    // letting the collector think the second press recorded a second day.
    const n = result.deposits.length;
    await redirectWithToast(
      "/susu",
      result.replayed
        ? {
            tone: "warning",
            message: "That collection was already recorded.",
            description: "Nothing was taken twice.",
          }
        : {
            tone: "success",
            message: `GH₵ ${formatAmount(result.totalAmount)} collected.`,
            description: `Split across ${n} account${n === 1 ? "" : "s"}.`,
          },
      headers,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data(
        { error: error.message, code: error.code, details: error.details as Mismatch },
        { status: error.status },
      );
    }
    throw error;
  }
}

export default function SusuCollect({ loaderData }: Route.ComponentProps) {
  const { preset } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [customer, setCustomer] = useState<PickedCustomer | null>(
    preset?.customer ?? null,
  );
  const [amount, setAmount] = useState(
    preset?.required ? toCedisInput(preset.required) : "",
  );
  const [channel, setChannel] = useState<DepositChannel>("cash");

  // Minted once per open, not per submit: a double click, or a retry after a
  // network wobble, has to carry the same key or the day is collected twice.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  const pesewas = parseCedis(amount);
  const required = preset?.required ?? null;
  const mismatch =
    required != null && pesewas != null && pesewas !== required ? required : null;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  const details =
    actionData && "details" in actionData
      ? (actionData.details as Mismatch | undefined)
      : undefined;

  return (
    <RouteSheet
      backTo="/susu"
      title="Collect all"
      description="One day into every active account this customer holds."
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {actionData?.error && (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <p className="flex items-start gap-2 font-medium">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                {actionData.error}
              </p>
              <Breakdown details={details} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Customer<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <CustomerPicker value={customer} onChange={setCustomer} autoFocus={!preset} />
          </div>

          {preset && preset.accounts.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Active accounts
              </p>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {preset.accounts.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="tabular text-muted-foreground">
                      #{a.accountNumber}
                    </span>
                    <span className="tabular font-medium">
                      {formatAmount(a.dailyAmount)}
                    </span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3 bg-muted/40 px-3 py-2 text-sm font-medium">
                  <span>Required today</span>
                  <span className="tabular">GH₵ {formatAmount(preset.required)}</span>
                </li>
              </ul>
            </div>
          )}

          <div className="space-y-1.5">
            <Label
              htmlFor="amount"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Cash received · GH₵<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="amount"
              name="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
              aria-invalid={mismatch != null ? true : undefined}
              className={cn("tabular", mismatch != null && "border-destructive")}
            />
            {mismatch != null && (
              <p className="text-xs text-destructive">
                Has to be exactly GH₵ {formatAmount(mismatch)} — the API takes all
                the accounts or none.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Channel
            </Label>
            <Select
              name="channel"
              value={channel}
              onValueChange={(v) => setChannel(v as DepositChannel)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNEL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
          <SheetCancel />
          <Button type="submit" disabled={submitting || !customer || !amount}>
            {submitting ? <Loader2Icon className="animate-spin" /> : <HandCoinsIcon />}
            Collect
          </Button>
        </div>
      </Form>
    </RouteSheet>
  );
}

/**
 * `AMOUNT_MISMATCH` comes back with the total the API wanted and the per-account
 * split behind it. That is the answer to "then how much?", so it is shown
 * rather than swallowed into a one-line error.
 */
function Breakdown({ details }: { details?: Mismatch }) {
  if (!details || (details.required == null && !details.breakdown?.length)) return null;
  return (
    <div className="space-y-1 text-destructive/90">
      {details.required != null && (
        <p>
          Required: <span className="tabular font-medium">GH₵ {formatAmount(details.required)}</span>
        </p>
      )}
      {details.breakdown?.length ? (
        <ul className="list-disc space-y-0.5 pl-4">
          {details.breakdown.slice(0, 10).map((row, i) => (
            <li key={i} className="tabular">
              #{row.accountNumber ?? "—"} · {formatAmount(row.dailyAmount ?? 0)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
