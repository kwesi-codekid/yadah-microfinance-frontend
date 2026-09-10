import { apiFetch } from "~/api/client";
import { queryOf } from "~/api/query";
import type { ChargeKind, MomoProvider, PaystackCharge } from "~/lib/payments";
import type { PayoutRequest, PayoutRequestKind, PayoutRequestStatus } from "~/lib/payout-requests";
import type {
  PortalAccounts,
  PortalProfile,
  PortalStatement,
  PortalTokens,
  PortalTransactions,
} from "~/lib/portal";

/**
 * The twelve `/portal` endpoints — the customer's own app. Server-only: this
 * imports the API client. Types live in the client-safe `~/lib/portal`.
 *
 * A separate token family from the staff API (`portalAuth`), so it has its
 * own session store in `~/lib/portal-session.server`. The customer is always
 * taken from the token; nothing here takes a customer id.
 */

/* -------------------------------------------------------------------- auth --- */

/**
 * POST /portal/auth/otp/request — always 202, registered or not, so the
 * endpoint cannot be used to discover who banks here. One code at a time,
 * 5 minutes, 5 attempts, one resend a minute.
 */
export function requestOtp(input: { phone: string }): Promise<{ sent: boolean }> {
  return apiFetch("/portal/auth/otp/request", { method: "POST", json: input });
}

/** POST /portal/auth/otp/verify — a wrong code and an unknown number look the same. */
export function verifyOtp(input: {
  phone: string;
  code: string;
}): Promise<{ tokens: PortalTokens; customer: PortalProfile }> {
  return apiFetch("/portal/auth/otp/verify", { method: "POST", json: input });
}

/** POST /portal/auth/refresh — single-use; a replay revokes the whole family. */
export function refresh(input: { refreshToken: string }): Promise<PortalTokens> {
  return apiFetch("/portal/auth/refresh", { method: "POST", json: input });
}

/** POST /portal/auth/logout */
export function logout(input: { refreshToken: string }): Promise<void> {
  return apiFetch("/portal/auth/logout", { method: "POST", json: input });
}

/** GET /portal/me */
export function me(accessToken: string): Promise<{ customer: PortalProfile }> {
  return apiFetch("/portal/me", { accessToken });
}

/* ------------------------------------------------------------------- money --- */

/**
 * GET /portal/accounts — every product, with the figures a handset should not
 * have to compute. Closed records are included so history stays visible.
 */
export function getAccounts(accessToken: string): Promise<PortalAccounts> {
  return apiFetch("/portal/accounts", { accessToken });
}

/** GET /portal/transactions — the unified feed, scoped to the customer. */
export function listTransactions(
  accessToken: string,
  params: { page?: number; limit?: number; from?: string; to?: string } = {},
): Promise<PortalTransactions> {
  return apiFetch(`/portal/transactions${queryOf({ ...params })}`, { accessToken });
}

/** GET /portal/statement — statement of account over a date range. */
export function getStatement(
  accessToken: string,
  params: { from?: string; to?: string } = {},
): Promise<PortalStatement> {
  return apiFetch(`/portal/statement${queryOf({ ...params })}`, { accessToken });
}

/**
 * POST /portal/payments/charges — pay into one of your own accounts by mobile
 * money. Another customer's account id is a 404, never a 403. Money is
 * recorded only when Paystack's webhook confirms it.
 */
export function startCharge(
  accessToken: string,
  input: {
    kind: Extract<ChargeKind, "susu-deposit" | "savings-deposit" | "loan-repayment">;
    targetId: string;
    amount: number;
    phone: string;
    provider: MomoProvider;
  },
): Promise<{ charge: PaystackCharge }> {
  return apiFetch("/portal/payments/charges", { method: "POST", json: input, accessToken });
}

/** GET /portal/payments/charges/{reference} — poll a charge you started. */
export function getCharge(
  accessToken: string,
  reference: string,
): Promise<{ charge: PaystackCharge }> {
  return apiFetch(`/portal/payments/charges/${encodeURIComponent(reference)}`, { accessToken });
}

/* ---------------------------------------------------------------- requests --- */

/**
 * POST /portal/requests — ask for a withdrawal. Never moves money by itself;
 * the office decides. The same limits a counter withdrawal has are checked
 * here, so a refusal comes now rather than after waiting. One open request
 * per account (409). `amount` is omitted for a closure.
 */
export function createRequest(
  accessToken: string,
  input: {
    kind: PayoutRequestKind;
    targetId: string;
    amount?: number;
    payoutPhone: string;
    payoutProvider: MomoProvider;
  },
): Promise<{ request: PayoutRequest }> {
  return apiFetch("/portal/requests", { method: "POST", json: input, accessToken });
}

/** GET /portal/requests — your withdrawal requests. */
export function listRequests(
  accessToken: string,
  params: { page?: number; limit?: number; status?: PayoutRequestStatus } = {},
): Promise<{ items: PayoutRequest[] }> {
  return apiFetch(`/portal/requests${queryOf({ ...params })}`, { accessToken });
}
