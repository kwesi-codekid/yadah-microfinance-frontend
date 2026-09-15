/**
 * Recording a susu or savings transaction on the day it actually happened.
 *
 * A stopgap for the data-population stage. The branch is typing in records for
 * days already past, and a deposit filed under the day it was keyed in lands
 * in the wrong day's collection sheet and the wrong day's cash reconciliation.
 *
 * Server-only, and read from the environment rather than the API so a drawer
 * does not have to ask a question to know whether to draw a field. The API is
 * the authority either way: it refuses a date unless its own
 * `ALLOW_BACKDATED_ENTRY` is set, so the worst a mismatch between the two can
 * do is offer a field whose answer comes back as a sentence the clerk reads.
 * Both services take the same variable, set in one place in Coolify.
 */

export function backdatingEnabled(): boolean {
  return process.env.ALLOW_BACKDATED_ENTRY === "true";
}

/** Today in Accra, which is UTC — the same day the API would resolve to. */
export function accraToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The day the form says the money moved, or undefined when it is simply today.
 *
 * Left on today — which is what every ordinary collection is — nothing is sent
 * at all, and the API takes the path it always took. So the everyday case
 * cannot be changed by this feature being switched on, only by somebody
 * deliberately choosing another day.
 */
export function occurredOnFromForm(form: FormData): string | undefined {
  const day = String(form.get("occurredOn") ?? "").trim();
  if (!day || day === accraToday()) return undefined;
  return day;
}
