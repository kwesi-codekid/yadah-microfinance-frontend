import { createCookie, redirect } from "react-router";

import { env } from "~/lib/env.server";

/**
 * Toasts that survive a redirect.
 *
 * Most of what the app does well ends in `throw redirect(...)`: a customer is
 * registered, a deposit is taken, an account is closed. The old page is gone by
 * the time the browser lands, so a toast fired in the action never renders and
 * the work completes in silence. This carries the message across in a cookie,
 * which the layout reads once and clears.
 *
 * A cookie of its own rather than a field on the session: the session cookie is
 * where the tokens live, `withAuth` already owns its `Set-Cookie` on every
 * response, and a second writer racing that one would drop a rotated refresh
 * token — which signs the user out. Two cookies, two owners, no collisions.
 */

export type ToastTone = "success" | "error" | "info" | "warning";

export interface Toast {
  tone: ToastTone;
  message: string;
  /** A second line — the figures behind a rejection, usually. */
  description?: string;
}

const COOKIE = createCookie("yadah_toast", {
  httpOnly: true,
  secure: env.sessionCookieSecure,
  sameSite: "lax",
  path: "/",
  domain: env.sessionCookieDomain,
  secrets: [env.sessionSecret, env.sessionSecretPrevious].filter(Boolean),
  // Long enough to survive the redirect it was set on, short enough that a
  // message never resurfaces on a later visit.
  maxAge: 60,
});

/** The `Set-Cookie` that carries one toast to the next request. */
export async function toastCookie(toast: Toast): Promise<string> {
  return COOKIE.serialize(toast);
}

/** The `Set-Cookie` that clears it, so a message shows exactly once. */
export async function clearToastCookie(): Promise<string> {
  return COOKIE.serialize("", { maxAge: 0 });
}

/** The toast waiting on this request, if any. */
export async function readToast(request: Request): Promise<Toast | null> {
  const value = await COOKIE.parse(request.headers.get("Cookie"));
  if (!value || typeof value !== "object") return null;
  const { tone, message, description } = value as Partial<Toast>;
  if (typeof message !== "string" || !message) return null;
  return {
    tone: isTone(tone) ? tone : "success",
    message,
    ...(typeof description === "string" ? { description } : {}),
  };
}

function isTone(value: unknown): value is ToastTone {
  return (
    value === "success" || value === "error" || value === "info" || value === "warning"
  );
}

/**
 * Redirect, and say what happened when you land.
 *
 * `existing` is whatever `withAuth` handed back — it holds the rotated refresh
 * token, and dropping it would end the session. Both cookies are appended to a
 * real `Headers`, because a plain object can only carry one `Set-Cookie`.
 */
export async function redirectWithToast(
  to: string,
  toast: Toast,
  existing?: { "Set-Cookie": string } | Headers,
): Promise<never> {
  throw redirect(to, { headers: await withToast(toast, existing) });
}

/** The headers for a redirect that carries a toast, without throwing. */
export async function withToast(
  toast: Toast,
  existing?: { "Set-Cookie": string } | Headers,
): Promise<Headers> {
  const headers = new Headers();
  if (existing instanceof Headers) {
    for (const value of existing.getSetCookie()) headers.append("Set-Cookie", value);
  } else if (existing?.["Set-Cookie"]) {
    headers.append("Set-Cookie", existing["Set-Cookie"]);
  }
  headers.append("Set-Cookie", await toastCookie(toast));
  return headers;
}
