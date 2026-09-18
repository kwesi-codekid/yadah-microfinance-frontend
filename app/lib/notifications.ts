/**
 * Notification types and display constants shared by the server and the
 * browser. Nothing here may import a `.server` module or the API client — it is
 * bundled into the client. The fetch functions live in `~/api/notifications`.
 *
 * Strictly per-user: there is no cross-user read, and collectors get them too.
 * One rule governs everything drawn from this module — **a notification is
 * never a source of truth about money.** It says something happened and links
 * to the record that actually holds the figures. So a row may carry an amount
 * for recognition, but nothing is ever reconciled, totalled or acted on from
 * here; the linked entity is.
 */

export type NotificationType =
  | "susu.deposit"
  | "susu.withdrawal"
  | "susu.payout"
  | "susu.carry-forward"
  | "txn.correction"
  | "savings.deposit"
  | "savings.withdrawal"
  | "customer.reassigned"
  | "reconciliation.declared"
  | "reconciliation.variance"
  | "loan.overdue";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /**
   * Whatever the API attached — ids of the records behind the event, usually.
   * Untyped on purpose: the shape varies per type and reading it defensively is
   * cheaper than a union that goes stale the next time a type is added.
   */
  data?: Record<string, unknown>;
  /** Absent while unread. Re-reading keeps the original timestamp. */
  readAt?: string;
  createdAt: string;
}

/** What `GET /notifications` answers with. */
export interface NotificationFeed {
  items: AppNotification[];
  page: number;
  limit: number;
  total: number;
  /** The **full** unread count, not just what is on this page. */
  unread: number;
}

/** What the browser needs before it may call `PushManager.subscribe()`. */
export interface PushConfig {
  /** False when the server has no VAPID keys. In-app still works. */
  enabled: boolean;
  publicKey: string;
}

/* ------------------------------------------------------------------ labels --- */

export const TYPE_LABELS: Record<NotificationType, string> = {
  "susu.deposit": "Susu deposit",
  "susu.withdrawal": "Susu withdrawal",
  "susu.payout": "Susu payout",
  "susu.carry-forward": "Susu carried forward",
  "txn.correction": "Correction",
  "savings.deposit": "Savings deposit",
  "savings.withdrawal": "Savings withdrawal",
  "customer.reassigned": "Customer reassigned",
  "reconciliation.declared": "Cash declared",
  "reconciliation.variance": "Cash variance",
  "loan.overdue": "Loan overdue",
};

/**
 * The tone each type carries in the list. Only two things here are a problem
 * rather than a record — a cash variance and an overdue loan — and they are the
 * two worth catching the eye; making everything coloured would mean nothing is.
 */
export const TYPE_TONE: Record<
  NotificationType,
  "success" | "info" | "warning" | "danger" | "muted"
> = {
  "susu.deposit": "success",
  "susu.withdrawal": "muted",
  "susu.payout": "muted",
  "susu.carry-forward": "info",
  // Somebody is waiting on it — the office for a decision, or the teller for
  // the answer — so it is drawn to be noticed.
  "txn.correction": "warning",
  "savings.deposit": "success",
  "savings.withdrawal": "muted",
  "customer.reassigned": "info",
  "reconciliation.declared": "info",
  "reconciliation.variance": "danger",
  "loan.overdue": "warning",
};

/** The filter chips, in the order the list offers them. */
export const TYPE_OPTIONS: { value: NotificationType; label: string }[] = (
  Object.keys(TYPE_LABELS) as NotificationType[]
).map((value) => ({ value, label: TYPE_LABELS[value] }));

/* ------------------------------------------------------------------- rules --- */

export function isUnread(n: Pick<AppNotification, "readAt">): boolean {
  return !n.readAt;
}

/**
 * A string id off a notification's `data`, or null.
 *
 * `data` is whatever the API attached and its shape moves with the event type,
 * so every read of it goes through here rather than a cast — a link built from
 * an id that turned out to be a number is a broken link, not a type error.
 */
export function dataId(
  n: Pick<AppNotification, "data">,
  key: string,
): string | null {
  const value = n.data?.[key];
  return typeof value === "string" && value ? value : null;
}

/** Where each kind of corrected entry's record lives. */
const CORRECTION_TARGET_PATHS: Record<string, string> = {
  "susu-deposit": "/susu",
  "savings-txn": "/savings",
  "loan-repayment": "/loans",
  "hp-payment": "/hire-purchase",
};

/**
 * Where a notification points, or null when it points nowhere in this app.
 *
 * The record, never a figure: the whole reason a notification is not a source
 * of truth is that the page it links to is.
 */
export function linkFor(n: AppNotification): string | null {
  const susu = dataId(n, "susuAccountId") ?? dataId(n, "accountId");
  const savings = dataId(n, "savingsAccountId");
  const loan = dataId(n, "loanId");
  const customer = dataId(n, "customerId");
  const reconciliation = dataId(n, "reconciliationId");

  switch (n.type) {
    case "susu.deposit":
    case "susu.withdrawal":
    case "susu.payout":
    case "susu.carry-forward":
      return susu ? `/susu/${susu}` : null;
    // The record's page is where a waiting correction is decided, and where
    // the figure it changed can be read afterwards; the queue when the
    // notification does not say which record.
    case "txn.correction": {
      const kind = n.data?.kind;
      const target = dataId(n, "targetId");
      if (!target || typeof kind !== "string") return "/corrections";
      const base = CORRECTION_TARGET_PATHS[kind];
      return base ? `${base}/${target}` : "/corrections";
    }
    case "savings.deposit":
    case "savings.withdrawal":
      return savings ? `/savings/${savings}` : null;
    case "loan.overdue":
      return loan ? `/loans/${loan}` : null;
    case "customer.reassigned":
      return customer ? `/customers/${customer}` : null;
    case "reconciliation.declared":
    case "reconciliation.variance":
      return reconciliation ? `/reconciliation/${reconciliation}` : "/reconciliation";
    default:
      return null;
  }
}

/**
 * The bell's badge. Past this it stops being a number people read and becomes a
 * shape they recognise, so it caps rather than growing to four digits.
 */
export function badgeCount(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 99 ? "99+" : String(unread);
}
