import {
  GraduationCapIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { data, Form, useActionData, useFetcher, useNavigation } from "react-router";
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
import { accraDay, formatAccraDate, formatAmount, parseCedis } from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import {
  ACCOUNT_TYPE_LABELS,
  CHANNEL_OPTIONS,
  MIN_BALANCE,
  MIN_DEPOSIT,
  WITHDRAWAL_FEE,
  FIXED_TERMS,
  maturityAfter,
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
  const fixed = accountType === "fixed";
  const guardianId = String(form.get("guardianId") ?? "").trim();
  const termMonths = Number(form.get("termMonths") ?? "");

  if (fixed && !guardianId) {
    return data({ error: "Choose the parent who is the guardian." }, { status: 400 });
  }
  if (fixed && !Number.isInteger(termMonths)) {
    return data({ error: "Pick the term." }, { status: 400 });
  }

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
        ...(fixed ? { guardianId, termMonths } : {}),
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
      description: fixed
        ? `Free withdrawals from ${formatAccraDate(maturityAfter(accraDay(), termMonths))}.`
        : `GH₵ ${formatAmount(MIN_BALANCE)} has to stay in the account until it is closed.`,
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
  const [guardian, setGuardian] = useState<PickedCustomer | null>(null);

  // A fixed deposit is a child's account, so it is only offered for one; picking
  // an adult afterwards puts the type back rather than leaving a choice the
  // API would refuse.
  const child = Boolean(customer?.isMinor);
  const fixed = type === "fixed";
  // Always listed, so the counter knows it exists; only usable for a child.
  const types: SavingsAccountType[] = ["standard", "student", "fixed", "loan"];
  useEffect(() => {
    if (!child && type === "fixed") setType("standard");
  }, [child, type]);

  // A child is usually registered on a parent's number, and only one adult
  // may hold a number, so that adult is the guardian nine times in ten. Looked
  // up once per child picked and filled in; the counter can still change it.
  const lookup = useFetcher<{ items: PickedCustomer[] }>();
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    setGuardian(null);
    filledFor.current = null;
    if (customer?.isMinor && customer.phone) {
      lookup.load(`/customers/search?q=${encodeURIComponent(customer.phone)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id]);
  useEffect(() => {
    if (!customer?.isMinor || filledFor.current === customer.id) return;
    const parent = lookup.data?.items.find(
      (c) => c.phone === customer.phone && !c.isMinor && c.id !== customer.id,
    );
    if (parent) {
      filledFor.current = customer.id;
      setGuardian(parent);
    }
  }, [lookup.data, customer]);
  const today = accraDay();

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
                {types.map((t) => (
                  <SelectItem key={t} value={t} disabled={t === "fixed" && !child}>
                    {ACCOUNT_TYPE_LABELS[t]}
                    {t === "fixed" && !child && (
                      <span className="text-xs text-muted-foreground">
                        {customer ? "· children only" : "· pick a child first"}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

          {fixed && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Guardian<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <CustomerPicker
                  name="guardianId"
                  value={guardian}
                  onChange={setGuardian}
                  placeholder="Parent's name or phone"
                  warn={(c) =>
                    c.id === customer?.id
                      ? "A child cannot be their own guardian."
                      : c.isMinor
                        ? "Under 18 — a guardian must be an adult."
                        : null
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Term<span className="ml-0.5 text-destructive">*</span>
                </Label>
                {/* Each term shows the day it runs to, so the parent hears a date. */}
                <Select name="termMonths" defaultValue={String(FIXED_TERMS[0])}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIXED_TERMS.map((months) => (
                      <SelectItem key={months} value={String(months)}>
                        {months} months
                        <span className="text-xs text-muted-foreground">
                          · {formatAccraDate(maturityAfter(today, months))}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
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
            {tooSmall && (
              <p className="text-xs text-destructive">
                At least GH₵ {formatAmount(MIN_DEPOSIT)}, or leave it empty.
              </p>
            )}
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

          {/* The rules that surprise people at the counter later. */}
          {!fixed && (
            <p className="text-xs text-muted-foreground">
              GH₵ {formatAmount(MIN_BALANCE)} stays in until closing; each
              withdrawal costs GH₵ {formatAmount(WITHDRAWAL_FEE)}.
              {belowMinimum && " Nothing is withdrawable from this first deposit."}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
          <SheetCancel />
          <Button
            type="submit"
            disabled={
              submitting ||
              !customer ||
              tooSmall ||
              (fixed &&
                (!guardian || guardian.isMinor || guardian.id === customer.id))
            }
          >
            {submitting && <Loader2Icon className="animate-spin" />}
            Open account
          </Button>
        </div>
      </Form>
    </RouteSheet>
  );
}
