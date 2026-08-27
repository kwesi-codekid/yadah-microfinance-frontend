import { apiFetch } from "~/api/client";
import { queryOf } from "~/api/query";
import type {
  AppNotification,
  NotificationFeed,
  NotificationType,
  PushConfig,
} from "~/lib/notifications";

/**
 * The `/notifications` endpoints. This module imports the API client, so it is
 * server-only: call it from loaders and actions. Types and display constants
 * live in the client-safe `~/lib/notifications`.
 *
 * Every role, including collectors, and strictly scoped to whoever is asking —
 * there is no parameter for reading another user's notifications and no screen
 * should imply there could be.
 */

export interface NotificationListParams {
  page?: number;
  limit?: number;
  unreadOnly?: "true" | "false";
  type?: NotificationType;
}

/**
 * GET /notifications — newest first, with the full unread count alongside.
 *
 * `unread` in the response is the total across everything, not the unread rows
 * on this page, so paging never changes it.
 */
export function listNotifications(
  accessToken: string,
  params: NotificationListParams = {},
): Promise<NotificationFeed> {
  return apiFetch(`/notifications${queryOf({ ...params })}`, { accessToken });
}

/**
 * GET /notifications/unread-count — the badge, and cheap enough for the bell to
 * poll on an interval.
 */
export function getUnreadCount(accessToken: string): Promise<{ unread: number }> {
  return apiFetch("/notifications/unread-count", { accessToken });
}

/** POST /notifications/{id}/read — idempotent; re-reading keeps the timestamp. */
export function markRead(
  accessToken: string,
  id: string,
): Promise<{ notification: AppNotification }> {
  return apiFetch(`/notifications/${id}/read`, { method: "POST", accessToken });
}

/** POST /notifications/read-all — answers with how many it changed. */
export function markAllRead(accessToken: string): Promise<{ updated: number }> {
  return apiFetch("/notifications/read-all", { method: "POST", accessToken });
}

/* ------------------------------------------------------------------- push --- */

/**
 * GET /notifications/push/config — what the browser needs before calling
 * `PushManager.subscribe()`.
 *
 * `enabled` is false when the server holds no VAPID keys. That is a
 * configuration state, not a fault: in-app notifications still work and browser
 * push is simply skipped, so the screen offers nothing rather than an error.
 */
export function getPushConfig(accessToken: string): Promise<PushConfig> {
  return apiFetch("/notifications/push/config", { accessToken });
}

/**
 * POST /notifications/push/subscribe — register this browser.
 *
 * Send the `PushSubscription` verbatim. Keyed on the endpoint, so re-subscribing
 * the same browser updates the record rather than piling up duplicates, and one
 * user may have several devices. Dead endpoints are pruned by the API when the
 * push service reports the subscription is gone, so there is nothing to clean
 * up from here.
 */
export function subscribePush(
  accessToken: string,
  input: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userAgent?: string;
  },
): Promise<{ subscribed: boolean }> {
  return apiFetch("/notifications/push/subscribe", {
    method: "POST",
    json: input,
    accessToken,
  });
}

/** POST /notifications/push/unsubscribe — idempotent; removing a gone endpoint succeeds. */
export function unsubscribePush(
  accessToken: string,
  endpoint: string,
): Promise<{ removed: number }> {
  return apiFetch("/notifications/push/unsubscribe", {
    method: "POST",
    json: { endpoint },
    accessToken,
  });
}
