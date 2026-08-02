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
