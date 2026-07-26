/**
 * How money arrived — one enum, shared by every product that takes it.
 *
 * The API declares the same `cash | paystack | momo` on susu deposits, savings
 * deposits, and collect-all. It lived in [susu-client.ts](app/lib/susu-client.ts)
 * while susu was the only thing wired; it isn't a susu concept, so it moved here
 * rather than being copied when savings arrived. `susu-client` re-exports the
 * names it used to own, so nothing that imported them had to change.
 *
 * Client-safe (no server-only imports).
 */

export type PaymentChannel = "cash" | "paystack" | "momo";

export const PAYMENT_CHANNELS: PaymentChannel[] = ["cash", "paystack", "momo"];

export const PAYMENT_CHANNEL_LABELS: Record<PaymentChannel, string> = {
  cash: "Cash",
  paystack: "Paystack",
  momo: "Mobile money",
};

export function isPaymentChannel(v: unknown): v is PaymentChannel {
  return typeof v === "string" && (PAYMENT_CHANNELS as string[]).includes(v);
}
