export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function readIdempotencyKey(
  form: FormData,
  fieldErrors: Record<string, string>,
): string {
  const key = String(form.get("idempotencyKey") ?? "").trim();
  if (key.length < 8 || key.length > 128) {
    fieldErrors.idempotencyKey =
      "This form went stale. Reload the page and try again.";
  }
  return key;
}
