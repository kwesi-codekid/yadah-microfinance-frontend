import { apiFetch } from "~/lib/api/client";
import type {
  TransferResult,
  TransferSource,
  TransferTarget,
} from "~/lib/transfer-client";

export interface TransferInput {
  from: TransferSource;
  to: TransferTarget;
  /**
   * Pesewas. Omit to move everything the source has — which for a susu account
   * means stopping it and sending the whole payout. Only a savings source or a
   * pending-payout susu balance accepts a partial amount.
   */
  amount?: number;
  /** 8–128 chars, from `newIdempotencyKey()`. Required. */
  idempotencyKey: string;
}

/** POST /transfers — one transaction across two products. */
export function createTransfer(
  accessToken: string,
  input: TransferInput,
): Promise<TransferResult> {
  return apiFetch("/transfers", {
    method: "POST",
    json: input,
    accessToken,
  });
}
