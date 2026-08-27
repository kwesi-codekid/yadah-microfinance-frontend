import { apiFetch } from "~/api/client";
import type { ChargeKind, MomoProvider, PaystackCharge } from "~/lib/payments";

/**
 * The `/payments` endpoints — charging a customer's mobile-money wallet through
 * Paystack. This module imports the API client, so it is server-only. Types and
 * the two-status rule live in the client-safe `~/lib/payments`.
 *
 * `POST /payments/paystack/webhook` is deliberately absent. Paystack calls it
 * server-to-server with an HMAC signature; it is not a client concern and
 * nothing in this app may call it.
 */

/**
 * POST /payments/charges — ask Paystack to charge a wallet.
 *
 * The API validates the target first — susu multiples, the savings minimum, the
 * loan or agreement's state — so a charge is never initiated against something
 * that could not accept the money anyway. Then it opens a `pay_offline` charge:
 * the customer approves a prompt on their own handset.
 *
 * `displayText` in the response is Paystack's instruction to the customer and
 * must be shown **verbatim**. Rewording it means telling someone the wrong
 * thing to press.
 *
 * Nothing is credited here. The money reaches the target when Paystack confirms
 * — by webhook, or by `verifyCharge` — through the same idempotent paths cash
 * uses, recorded with channel `paystack`.
 */
export function createCharge(
  accessToken: string,
  input: {
    kind: ChargeKind;
    targetId: string;
    /** Pesewas. Omitted for `hp-redemption`, which is always the full balance. */
    amount?: number;
    /** `^0[25]\d{8}$`. */
    phone: string;
    provider: MomoProvider;
  },
): Promise<{ charge: PaystackCharge }> {
  return apiFetch("/payments/charges", {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * GET /payments/charges/{reference} — where the charge has got to.
 *
 * Poll this after initiating. Both statuses move independently: `status` is
 * Paystack's view of the money, `executionStatus` is whether it landed on the
 * record. Read both, show both.
 */
export function getCharge(
  accessToken: string,
  reference: string,
): Promise<{ charge: PaystackCharge }> {
  return apiFetch(`/payments/charges/${reference}`, { accessToken });
}

/**
 * POST /payments/charges/{reference}/verify — ask Paystack directly and apply
 * the result if it was paid.
 *
 * This is the missed-webhook fallback and it is safe to call repeatedly:
 * application is idempotent on the API's side. It is the button the office
 * presses on a charge that Paystack says is paid but the ledger does not.
 */
export function verifyCharge(
  accessToken: string,
  reference: string,
): Promise<{ charge: PaystackCharge }> {
  return apiFetch(`/payments/charges/${reference}/verify`, {
    method: "POST",
    accessToken,
  });
}
