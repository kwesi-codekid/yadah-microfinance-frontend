import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { openCashAccount } from "~/api/accounting";
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
import {
  CASH_ACCOUNT_KIND_OPTIONS,
  CASH_CHANNEL_OPTIONS,
  DEFAULT_CHANNEL_FOR_KIND,
  type CashAccountKind,
  type CashChannel,
} from "~/lib/accounting";
import { accraDay, formatPesewas, parseCedis } from "~/lib/format";
import { requireAdmin, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/accounting-account-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Open a company account · Yadah Dynamic Enterprise" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = CASH_ACCOUNT_KIND_OPTIONS.map((o) => o.value);
const CHANNELS = CASH_CHANNEL_OPTIONS.map((o) => o.value);

/**
 * `POST /accounting/cash-accounts` — admin only.
 *
 * The opening balance is where every statement starts counting from, so it
 * has to be a reconciled figure rather than a guess. The API allows one active
 * account per channel and answers a second with `409`, which is passed on
 * word for word: it names the account already on that channel.
 */
export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const kind = String(form.get("kind") ?? "") as CashAccountKind;
  const channel = String(form.get("channel") ?? "") as CashChannel;
  const openingBalance = parseCedis(String(form.get("openingBalance") ?? "").trim());
  const openingDate = String(form.get("openingDate") ?? "").trim();
  const bankName = String(form.get("bankName") ?? "").trim();
  const accountNumber = String(form.get("accountNumber") ?? "").trim();

  if (!name) return data({ error: "Give the account a name." }, { status: 400 });
  if (!KINDS.includes(kind)) {
    return data({ error: "Say what kind of account it is." }, { status: 400 });
  }
  if (!CHANNELS.includes(channel)) {
    return data({ error: "Say which channel it takes." }, { status: 400 });
  }
  if (openingBalance == null || openingBalance < 0) {
    return data(
      { error: "Enter the opening balance, even if it is zero." },
      { status: 400 },
    );
  }
  if (!DAY_RE.test(openingDate)) {
    return data({ error: "Pick the day the opening balance was true on." }, { status: 400 });
  }
  if (openingDate > accraDay()) {
    return data({ error: "An account cannot open in the future." }, { status: 400 });
  }

  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ headers } = await withAuth(request, (token) =>
      openCashAccount(token, {
        name,
        kind,
        channel,
        openingBalance,
        openingDate,
        bankName: bankName || undefined,
        accountNumber: accountNumber || undefined,
      }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  await redirectWithToast(
    "/accounting",
    {
      tone: "success",
      message: `${name} opened.`,
      description:
        openingBalance > 0
          ? `Record the matching ${formatPesewas(openingBalance)} as opening capital, or the balance sheet will report it as unmatched cash.`
          : undefined,
    },
    headers,
  );
}

export default function AccountingAccountNew() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [kind, setKind] = useState<CashAccountKind>("cash-on-hand");
  const [channel, setChannel] = useState<CashChannel>("cash");
  const [opening, setOpening] = useState("");
  const openingPesewas = parseCedis(opening);
  const bankish = kind === "bank";

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo="/accounting"
      title="Open a company account"
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
            <Label htmlFor="name" className="eyebrow text-muted-foreground">
              Name<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              autoFocus
              autoComplete="off"
              maxLength={120}
              placeholder={bankish ? "GCB current account" : "Office drawer"}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="kind" className="eyebrow text-muted-foreground">
                Kind<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Select
                name="kind"
                value={kind}
                onValueChange={(v) => {
                  const next = v as CashAccountKind;
                  setKind(next);
                  setChannel(DEFAULT_CHANNEL_FOR_KIND[next]);
                }}
              >
                <SelectTrigger id="kind" className="w-full">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {CASH_ACCOUNT_KIND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="channel" className="eyebrow text-muted-foreground">
                Channel<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Select
                name="channel"
                value={channel}
                onValueChange={(v) => setChannel(v as CashChannel)}
              >
                <SelectTrigger id="channel" className="w-full">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {CASH_CHANNEL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            Customer money is tied to an account by the channel it was recorded
            on. Everything taken in cash lands on the cash account; MoMo and
            Paystack on theirs.
          </p>

          {bankish && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bankName" className="eyebrow text-muted-foreground">
                  Bank
                </Label>
                <Input id="bankName" name="bankName" autoComplete="off" maxLength={80} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="accountNumber" className="eyebrow text-muted-foreground">
                  Account number
                </Label>
                <Input
                  id="accountNumber"
                  name="accountNumber"
                  autoComplete="off"
                  maxLength={40}
                  className="tabular"
                />
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="openingBalance" className="eyebrow text-muted-foreground">
                Opening balance · GH₵<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="openingBalance"
                name="openingBalance"
                value={opening}
                onChange={(event) => setOpening(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                className="tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="openingDate" className="eyebrow text-muted-foreground">
                True on<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <DateField
                id="openingDate"
                name="openingDate"
                defaultValue={accraDay()}
                endMonth={new Date()}
                required
              />
            </div>
          </div>

          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Set the opening balance once, from a real reconciled figure — every
            statement counts forward from it.
            {openingPesewas != null && openingPesewas > 0 && (
              <>
                {" "}
                Then record {formatPesewas(openingPesewas)} as an opening
                contribution under Capital, or the balance sheet will report it
                as a difference it cannot explain.
              </>
            )}
          </p>
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2Icon className="animate-spin" />}
            Open account
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
