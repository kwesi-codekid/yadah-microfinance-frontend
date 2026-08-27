import { data } from "react-router";

import { ApiError } from "~/api/error";
import { createCharge } from "~/api/payments";
import { parseCedis } from "~/lib/format";
import {
  checkPhone,
  needsAmount,
  type ChargeKind,
  type MomoProvider,
} from "~/lib/payments";
import { withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";

/**
 * Opening a charge is the same errand six times over — susu, savings, a loan,
 * three kinds of hire-purchase payment — differing only in `kind` and which
 * record it points at. This is that errand, so the six drawers are each just a
 * form and the figures around it.
 *
 * It either throws a redirect to the charge screen or returns the fault to put
 * above the form. Every one of them lands on the same place afterwards: the
 * drawer is not somewhere to wait, because the customer still has to approve a
 * prompt on a handset and that can take a minute.
 */
export interface ChargeFault {
  error: string;
  code?: string;
}

const fault = (error: string, status: number, code?: string) =>
  data<ChargeFault>({ error, code }, { status });

export async function startCharge(
  request: Request,
  kind: ChargeKind,
  targetId: string,
) {
  const form = await request.formData();
  const phone = String(form.get("phone") ?? "").trim();
  const provider = String(form.get("provider") ?? "mtn") as MomoProvider;
  const raw = String(form.get("amount") ?? "").trim();

  const phoneFault = checkPhone(phone);
  if (phoneFault) return fault(phoneFault, 400);

  // Redemption is always the full remaining balance and takes no amount at all;
  // sending one would be sending a figure the API is right to ignore.
  let amount: number | undefined;
  if (needsAmount(kind)) {
    const parsed = parseCedis(raw);
    if (parsed == null || parsed <= 0) {
      return fault("Enter the amount to charge.", 400);
    }
    amount = parsed;
  }

  let result: Awaited<ReturnType<typeof createCharge>>;
  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ data: result, headers } = await withAuth(request, (token) =>
      createCharge(token, { kind, targetId, amount, phone, provider }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return fault(error.message, error.status, error.code);
    }
    throw error;
  }

  // Outside the `try` on purpose: this throws a redirect, and a redirect caught
  // by the handler above would be one refusal away from being swallowed.
  return await redirectWithToast(
    `/payments/charges/${result.charge.reference}`,
    {
      tone: "info",
      message: "Prompt sent.",
      // Paystack's own instruction, verbatim — rewording it means telling
      // someone the wrong thing to press.
      description:
        result.charge.displayText ??
        "The customer approves it on their handset. Nothing is credited until they do.",
    },
    headers,
  );
}
