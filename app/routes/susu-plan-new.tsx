import { Loader2Icon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  data,
  Form,
  useActionData,
  useNavigation,
  useRouteLoaderData,
} from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { addPlan } from "~/api/susu";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatAmount, parseCedis } from "~/lib/format";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { MIN_DAILY_AMOUNT } from "~/lib/susu";
import type { loader as detailLoader } from "./susu-detail";
import type { Route } from "./+types/susu-plan-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Add a plan · Yadah Dynamic Enterprise" }];
}

/**
 * A second (or third) daily amount on the same account. It runs its own
 * cycle of 31 payments beside the others, and that cycle starts with its
 * first deposit — nothing is owed or locked for it until then.
 *
 * Counter work. The gate is all this loader does: the account is already on
 * the page underneath.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireCounter(request);
  return null;
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const dailyAmount = parseCedis(String(form.get("dailyAmount") ?? ""));

  if (dailyAmount == null || dailyAmount < MIN_DAILY_AMOUNT) {
    return data(
      { error: `The daily amount is at least GH₵ ${formatAmount(MIN_DAILY_AMOUNT)}.` },
      { status: 400 },
    );
  }

  try {
    const { headers } = await withAuth(request, (token) =>
      addPlan(token, params.id, { dailyAmount }),
    );
    await redirectWithToast(
      `/susu/${params.id}`,
      {
        tone: "success",
        message: `Plan added at GH₵ ${formatAmount(dailyAmount)} a day.`,
        description: "Its cycle starts with its first deposit.",
      },
      headers,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export default function SusuPlanNew() {
  const detail = useRouteLoaderData<typeof detailLoader>("routes/susu-detail");
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [daily, setDaily] = useState("");

  // Anything the drawer has to say is a toast. The form is the one field.
  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  if (!detail) return null;
  const { account } = detail;

  const pesewas = parseCedis(daily);
  const tooSmall = daily !== "" && (pesewas == null || pesewas < MIN_DAILY_AMOUNT);

  return (
    <RouteSheet backTo={`/susu/${account.id}`} title="Add a plan">
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <div className="space-y-1.5">
            <Label
              htmlFor="dailyAmount"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              New plan · GH₵ a day<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="dailyAmount"
              name="dailyAmount"
              value={daily}
              onChange={(e) => setDaily(e.target.value)}
              // A figure under the minimum is said when they leave the field,
              // not on every keystroke on the way to a right one.
              onBlur={() => {
                if (tooSmall) {
                  toast.error(`The daily amount is at least GH₵ ${formatAmount(MIN_DAILY_AMOUNT)}.`);
                }
              }}
              inputMode="decimal"
              placeholder="20.00"
              autoComplete="off"
              autoFocus
              aria-invalid={tooSmall ? true : undefined}
              className="tabular text-lg"
            />
          </div>
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting || tooSmall || !daily}>
            {submitting ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
            Add plan
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
