import { BellIcon, CheckCheckIcon, CheckIcon } from "lucide-react";
import { useEffect } from "react";
import {
  data,
  Link,
  useFetcher,
  useNavigation,
  useSubmit,
} from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { listNotifications, markAllRead, markRead } from "~/api/notifications";
import {
  ChoiceFilter,
  FilterBar,
  FilterChip,
  ListingCard,
  ListingFooter,
  ListingToolbar,
  StatusPill,
} from "~/components/listing";
import { Page, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { formatAccraDateTime, formatCount } from "~/lib/format";
import {
  TYPE_LABELS,
  TYPE_OPTIONS,
  TYPE_TONE,
  isUnread,
  linkFor,
  type AppNotification,
  type NotificationType,
} from "~/lib/notifications";
import { requireUser, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/notifications";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Notifications · Yadah Dynamic Enterprise" }];
}

const PAGE_SIZE = 25;

const TYPES = TYPE_OPTIONS.map((o) => o.value);

interface Filters {
  unreadOnly: boolean;
  type: NotificationType | "";
}

function readFilters(url: URL): Filters {
  const typeParam = url.searchParams.get("type") as NotificationType | null;
  return {
    unreadOnly: url.searchParams.get("unread") === "1",
    type: typeParam && TYPES.includes(typeParam) ? typeParam : "",
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.unreadOnly) p.set("unread", "1");
  if (f.type) p.set("type", f.type);
  if (page > 1) p.set("page", String(page));
  return p;
}

function hrefFor(f: Filters, page = 1): string {
  const s = queryFor(f, page).toString();
  return s ? `/notifications?${s}` : "/notifications";
}

/**
 * `GET /notifications` — every role, and strictly the asker's own. There is no
 * parameter for reading someone else's, which is why nothing here takes a user.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  const url = new URL(request.url);

  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: feed, headers } = await withAuth(request, (token) =>
    listNotifications(token, {
      page,
      limit: PAGE_SIZE,
      unreadOnly: filters.unreadOnly ? "true" : undefined,
      type: filters.type || undefined,
    }),
  );

  return data(
    {
      filters,
      page,
      total: feed.total,
      // The full unread count, not the unread rows on this page.
      unread: feed.unread,
      rows: feed.items.map(toRow),
    },
    { headers },
  );
}

interface ActionResult {
  ok: boolean;
  message: string;
}

/** Marking one read, or all of them. Both are idempotent on the API's side. */
export async function action({ request }: Route.ActionArgs) {
  await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");

  try {
    if (intent === "read-all") {
      const { data: result, headers } = await withAuth(request, (token) =>
        markAllRead(token),
      );
      return data<ActionResult>(
        {
          ok: true,
          message:
            result.updated === 0
              ? "Nothing was unread."
              : `${formatCount(result.updated)} marked read.`,
        },
        { headers },
      );
    }

    if (intent === "read" && id) {
      const { headers } = await withAuth(request, (token) => markRead(token, id));
      return data<ActionResult>({ ok: true, message: "Marked read." }, { headers });
    }

    return data<ActionResult>({ ok: false, message: "Nothing to do." }, { status: 400 });
  } catch (error) {
    if (error instanceof ApiError) {
      return data<ActionResult>(
        { ok: false, message: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}

/* -------------------------------------------------------------------- rows --- */

interface Row {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  unread: boolean;
  to: string | null;
  createdAt: string;
}

function toRow(n: AppNotification): Row {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    unread: isUnread(n),
    to: linkFor(n),
    createdAt: n.createdAt,
  };
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const { filters, page, total, unread, rows } = loaderData;
  const submit = useSubmit();
  const navigation = useNavigation();
  const fetcher = useFetcher<ActionResult>();

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) toast.success(fetcher.data.message);
    else toast.error(fetcher.data.message);
  }, [fetcher.data]);

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), {
      replace: true,
      preventScrollReset: true,
    });

  const narrowed = Boolean(filters.unreadOnly || filters.type);
  const busy = navigation.state !== "idle";

  return (
    <Page className="max-w-none">
      <PageHeader
        title="Notifications"
        description="What happened, and where to look at it properly."
        actions={
          <Button
            variant="outline"
            disabled={unread === 0 || busy || fetcher.state !== "idle"}
            onClick={() => fetcher.submit({ intent: "read-all" }, { method: "post" })}
          >
            <CheckCheckIcon />
            Mark all read
          </Button>
        }
      />

      <ListingCard>
        <ListingToolbar
          tabs={
            <p className="text-sm text-muted-foreground">
              {unread > 0 ? (
                <>
                  <span className="font-semibold text-foreground">
                    {formatCount(unread)}
                  </span>{" "}
                  unread
                </>
              ) : (
                "Nothing unread"
              )}
            </p>
          }
        >
          <Button
            variant="outline"
            size="sm"
            aria-pressed={filters.unreadOnly}
            onClick={() => apply({ unreadOnly: !filters.unreadOnly })}
            className={cn(filters.unreadOnly && "border-primary/50 text-primary")}
          >
            <BellIcon />
            Unread only
          </Button>
          <ChoiceFilter
            value={filters.type}
            options={TYPE_OPTIONS}
            apply={(next) => apply({ type: next })}
            title="Kind"
            allLabel="Every kind"
            width="w-56"
          />
        </ListingToolbar>

        {narrowed && (
          <FilterBar total={total}>
            {filters.unreadOnly && (
              <FilterChip
                label="Unread only"
                onDrop={() => apply({ unreadOnly: false })}
              />
            )}
            {filters.type && (
              <FilterChip
                label={TYPE_LABELS[filters.type]}
                onDrop={() => apply({ type: "" })}
              />
            )}
          </FilterBar>
        )}

        {rows.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BellIcon />
              </EmptyMedia>
              <EmptyTitle>
                {narrowed ? "Nothing matches" : "Nothing yet"}
              </EmptyTitle>
              <EmptyDescription>
                {narrowed
                  ? "Clear the filters to see everything."
                  : "Deposits, payouts, reassignments and cash variances show up here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li
                key={row.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3",
                  row.unread && "bg-muted/30",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-2 size-1.5 shrink-0 rounded-full",
                    row.unread ? "bg-brand-coral" : "bg-transparent",
                  )}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {/* The record is where the figures live, so the title is
                        the link and the notification itself never is. */}
                    {row.to ? (
                      <Link
                        to={row.to}
                        prefetch="intent"
                        className={cn(
                          "underline-offset-4 hover:underline",
                          row.unread ? "font-semibold" : "font-medium",
                        )}
                      >
                        {row.title}
                      </Link>
                    ) : (
                      <span className={row.unread ? "font-semibold" : "font-medium"}>
                        {row.title}
                      </span>
                    )}
                    <StatusPill
                      label={TYPE_LABELS[row.type] ?? row.type}
                      tone={TYPE_TONE[row.type] ?? "muted"}
                    />
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{row.body}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatAccraDateTime(row.createdAt)}
                  </p>
                </div>

                {row.unread && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    disabled={fetcher.state !== "idle"}
                    onClick={() =>
                      fetcher.submit({ intent: "read", id: row.id }, { method: "post" })
                    }
                  >
                    <CheckIcon />
                    <span className="sr-only">Mark “{row.title}” read</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <ListingFooter
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          hrefFor={(p) => hrefFor(filters, p)}
        />
      </ListingCard>
    </Page>
  );
}
