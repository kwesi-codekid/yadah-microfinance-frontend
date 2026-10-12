/**
 * Someone the account holder sent to collect a withdrawal for them. The
 * counter takes their name and phone; the API stores both on the withdrawal,
 * prints them on the receipt and names them in the SMS to the holder.
 */
export interface CollectedBy {
  name: string;
  phone: string;
}

/** Ghana mobile number, in any of the ways people type one. The API normalizes. */
export function checkCollectorPhone(value: string): string | null {
  const compact = value.replace(/[\s().-]/g, "");
  if (!compact) return "Enter their phone number.";
  if (!/^(?:\+?233|0)[25]\d{8}$/.test(compact)) {
    return "Enter a Ghana mobile number, like 0244123456.";
  }
  return null;
}

export function checkCollectorName(value: string): string | null {
  const name = value.trim();
  if (!name) return "Enter the name of the person collecting.";
  if (name.length < 2) return "Enter their full name.";
  return null;
}

/**
 * Reads the block `CollectedByFields` submits. Nothing when the holder came
 * themselves; an error when the box was ticked but a field is missing.
 */
export function readCollectedBy(
  form: FormData,
): { collectedBy?: CollectedBy; error?: string } {
  if (form.get("onBehalf") !== "1") return {};
  const name = String(form.get("collectorName") ?? "").trim();
  const phone = String(form.get("collectorPhone") ?? "").trim();
  const error = checkCollectorName(name) ?? checkCollectorPhone(phone);
  if (error) return { error };
  return { collectedBy: { name, phone } };
}
