import { GraduationCapIcon, InfoIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { openAccount } from "~/api/savings";
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
import { formatAmount, parseCedis } from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import {
  ACCOUNT_TYPE_LABELS,
  CHANNEL_OPTIONS,
  MIN_BALANCE,
  MIN_DEPOSIT,
  WITHDRAWAL_FEE,
  type SavingsAccountType,
  type SavingsChannel,
} from "~/lib/savings";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/savings-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Open a savings account · Yadah Dynamic Enterprise" }];
}

/** Opening an account is office-only — enforced here, not just by hiding it. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireCounter(request);
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const customerId = String(form.get("customerId") ?? "").trim();
  const accountType = String(form.get("accountType") ?? "standard") as SavingsAccountType;
  const channel = String(form.get("channel") ?? "cash") as SavingsChannel;
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");
  const typed = String(form.get("initialDeposit") ?? "").trim();
  const initialDeposit = typed ? parseCedis(typed) : null;

  if (!customerId) {
    return data(
      { error: "Choose the customer this account belongs to." },
      { status: 400 },
    );
  }
  // Empty is fine — the account opens at zero. A number that is there but too
  // small is a typo worth catching before the round trip.
  if (typed && (initialDeposit == null || initialDeposit < MIN_DEPOSIT)) {
    return data(
      { error: `A first deposit is at least GH₵ ${formatAmount(MIN_DEPOSIT)}.` },
      { status: 400 },
    );
  }

  let result: { account: { id: string } };
  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ data: result, headers } = await withAuth(request, (token) =>
      openAccount(token, {
        customerId,
        accountType,
        // The deposit rides in the same transaction as the opening, so it
        // carries the key that makes a retry safe.
        ...(initialDeposit
          ? { initialDeposit, idempotencyKey, channel }
          : {}),
      }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status },
      );
    }
    throw error;
  }

  // Straight to the new account, where the next deposit is recorded.
  await redirectWithToast(
    `/savings/${result.account.id}`,
    {
      tone: "success",
      message: initialDeposit
        ? `Account opened with GH₵ ${formatAmount(initialDeposit)} in it.`
        : "Account opened.",
      description: `GH₵ ${formatAmount(MIN_BALANCE)} has to stay in the account until it is closed.`,
    },
    headers,
  );
}

export default function SavingsNew() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [type, setType] = useState<SavingsAccountType>("standard");
  const [deposit, setDeposit] = useState("");

  // Minted once per open: the first deposit is money, and a double click or a
  // retry after a dropped connection has to carry the same key.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  const pesewas = parseCedis(deposit);
  const tooSmall = deposit !== "" && (pesewas == null || pesewas < MIN_DEPOSIT);
  const belowMinimum =
    pesewas != null && !tooSmall && pesewas < MIN_BALANCE;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet backTo="/savings" title="Open a savings account">
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

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
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Customer<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <CustomerPicker value={customer} onChange={setCustomer} autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Account type
            </Label>
            <Select
              name="accountType"
              value={type}
              onValueChange={(v) => setType(v as SavingsAccountType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["standard", "student"] as const).map((t) => (
                  <SelectItem key={t} value={t}>
                    {ACCOUNT_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A label on the record. The deposit, withdrawal and fee rules are
              the same either way.
            </p>
          </div>

          {/* The part of a student account that is procedure rather than API:
              nothing here enforces it, so this is the only place it gets said. */}
          {type === "student" && (
            <div className="flex items-start gap-2 rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-sm">
              <GraduationCapIcon className="mt-0.5 size-4 shrink-0 text-info" />
              <div className="space-y-1">
                <p className="font-medium">The customer record is the minor.</p>
                <p className="text-muted-foreground">
                  Put the guardian's ID in the customer's identification fields
                  and record the guardian as next of kin before opening this.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label
              htmlFor="initialDeposit"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              First deposit · GH₵
            </Label>
            <Input
              id="initialDeposit"
              name="initialDeposit"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              inputMode="decimal"
              placeholder="Optional"
              autoComplete="off"
              aria-invalid={tooSmall ? true : undefined}
              className={cn("tabular", tooSmall && "border-destructive")}
            />
            <p
              className={cn(
                "text-xs",
                tooSmall ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {tooSmall
                ? `At least GH₵ ${formatAmount(MIN_DEPOSIT)}, or leave it empty.`
                : "Recorded with the opening, in one transaction. Leave it empty to open at zero."}
            </p>
          </div>

          {deposit && !tooSmall && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Channel
              </Label>
              <Select name="channel" defaultValue="cash">
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
          )}

          {/* The two rules that surprise people at the counter later. Said now,
              while the customer is still standing there. */}
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              GH₵ {formatAmount(MIN_BALANCE)} stays in the account until it is
              closed, and every withdrawal costs a flat GH₵{" "}
              {formatAmount(WITHDRAWAL_FEE)} on top of the cash handed over.
              {belowMinimum && (
                <>
                  {" "}
                  A first deposit of GH₵ {formatAmount(pesewas!)} leaves nothing
                  withdrawable yet.
                </>
              )}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
          <SheetCancel />
          <Button type="submit" disabled={submitting || !customer || tooSmall}>
            {submitting && <Loader2Icon className="animate-spin" />}
            Open account
          </Button>
        </div>
      </Form>
    </RouteSheet>
  );
}
