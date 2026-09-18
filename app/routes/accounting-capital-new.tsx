import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation, useSearchParams } from "react-router";
import { toast } from "sonner";

import { listCashAccounts, recordCapital } from "~/api/accounting";
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
  CAPITAL_KIND_BLURBS,
  CAPITAL_KIND_LABELS,
  CASH_ACCOUNT_KIND_LABELS,
  type CapitalKind,
} from "~/lib/accounting";
import { accraDay, formatPesewas, parseCedis } from "~/lib/format";
import { requireAdmin, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/accounting-capital-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Record capital · Yadah Dynamic Enterprise" }];
}

/** The accounts the money can land in or leave from. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const { data: accounts, headers } = await withAuth(request, (token) =>
    listCashAccounts(token),
  );
  return data(
    {
      accounts: accounts
        .filter((a) => (a.status ?? "active") === "active")
        .map((a) => ({
          id: a.id,
          name: a.name,
          kind: CASH_ACCOUNT_KIND_LABELS[a.kind] ?? a.kind,
        })),
    },
    { headers },
  );
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: CapitalKind[] = ["contribution", "drawing"];

/**
 * `POST /accounting/capital` — admin only.
 *
 * The account is optional on the API, but a contribution with no account
 * named is money that arrived nowhere, so the form asks for one and only lets
 * it go when there is none to pick.
 */
export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const kind = String(form.get("kind") ?? "") as CapitalKind;
  const amount = parseCedis(String(form.get("amount") ?? "").trim());
  const occurredOn = String(form.get("occurredOn") ?? "").trim();
  const cashAccountId = String(form.get("cashAccountId") ?? "").trim();
  const note = String(form.get("note") ?? "").trim();

  if (!KINDS.includes(kind)) {
    return data({ error: "Say whether money came in or went out." }, { status: 400 });
  }
  if (amount == null || amount < 1) {
    return data({ error: "Enter the amount." }, { status: 400 });
  }
  if (!DAY_RE.test(occurredOn)) {
    return data({ error: "Pick the day it happened." }, { status: 400 });
  }
  if (occurredOn > accraDay()) {
    return data({ error: "That day has not happened yet." }, { status: 400 });
  }

  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ headers } = await withAuth(request, (token) =>
      recordCapital(token, {
        kind,
        amount,
        occurredOn,
        cashAccountId: cashAccountId || undefined,
        note: note || undefined,
      }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  await redirectWithToast(
    "/accounting/capital",
    {
      tone: "success",
      message:
        kind === "contribution"
          ? `${formatPesewas(amount)} contributed.`
          : `${formatPesewas(amount)} drawn.`,
    },
    headers,
  );
}

export default function AccountingCapitalNew({ loaderData }: Route.ComponentProps) {
  const { accounts } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const submitting = navigation.state === "submitting";

  const [kind, setKind] = useState<CapitalKind>("contribution");
  const preset = params.get("account") ?? "";
  const [account, setAccount] = useState(
    accounts.some((a) => a.id === preset) ? preset : (accounts[0]?.id ?? ""),
  );

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo="/accounting/capital"
      title="Record capital"
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

          {/* Two big choices rather than a dropdown: there are only two, and
              which one it is changes the sign of everything below. */}
          <fieldset className="space-y-1.5">
            <legend className="eyebrow text-muted-foreground">
              What happened<span className="ml-0.5 text-destructive">*</span>
            </legend>
            <input type="hidden" name="kind" value={kind} />
            <div className="grid grid-cols-2 gap-2">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    kind === k
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:border-primary/30",
                  )}
                >
                  <span className="block text-sm font-medium">{CAPITAL_KIND_LABELS[k]}</span>
                  <span className="block text-xs text-muted-foreground">
                    {CAPITAL_KIND_BLURBS[k]}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="amount" className="eyebrow text-muted-foreground">
                Amount · GH₵<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="amount"
                name="amount"
                autoFocus
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                className="tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="occurredOn" className="eyebrow text-muted-foreground">
                On<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <DateField
                id="occurredOn"
                name="occurredOn"
                defaultValue={accraDay()}
                endMonth={new Date()}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cashAccountId" className="eyebrow text-muted-foreground">
              {kind === "contribution" ? "Into" : "Out of"}
            </Label>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No company account to name yet.
              </p>
            ) : (
              <Select name="cashAccountId" value={account} onValueChange={setAccount}>
                <SelectTrigger id="cashAccountId" className="w-full">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                      <span className="ml-1 text-muted-foreground">· {a.kind}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note" className="eyebrow text-muted-foreground">
              Note
            </Label>
            <Textarea
              id="note"
              name="note"
              rows={2}
              maxLength={300}
              placeholder={
                kind === "contribution" ? "Opening capital at go-live" : "Owner’s monthly draw"
              }
            />
          </div>
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2Icon className="animate-spin" />}
            {kind === "contribution" ? "Record contribution" : "Record drawing"}
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
