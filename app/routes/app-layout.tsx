import { BellIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { data, Form, Link, Outlet, useLocation, useMatches } from "react-router";
import { toast as sonner } from "sonner";

import * as authApi from "~/api/auth";
import { ApiError } from "~/api/error";
import { listNotifications } from "~/api/notifications";
import { AppSidebar } from "~/components/app-sidebar";
import { navItemFor } from "~/components/nav-items";
import { ProfileMenu } from "~/components/profile-menu";
import { ThemeToggle } from "~/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/ui/sidebar";
import { TooltipProvider } from "~/components/ui/tooltip";
import type { AuthUser } from "~/lib/auth";
import { formatCount } from "~/lib/format";
import { badgeCount, isUnread, linkFor } from "~/lib/notifications";
import { requireUser, signOutForRoleChange, withAuth } from "~/lib/session.server";
import { clearToastCookie, readToast, type Toast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/app-layout";

/**
 * Every signed-in page renders under this layout, which makes it the place we
 * notice that an admin changed someone's role while they were working: the
 * role in the cookie is only as good as the last time we asked the API.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);

  const { data: result, headers } = await withAuth(
    request,
    async (token, session) => {
      if (!session.roleCheckDue) return { user, roleChanged: false };

      let fresh: AuthUser;
      try {
        ({ user: fresh } = await authApi.me(token));
      } catch (error) {
        // A 401 belongs to `withAuth`, which renews the token and retries.
        if (error instanceof ApiError && error.status === 401) throw error;
        // Anything else is the network, not the account — a background check
        // must not take the whole app down.
        return { user, roleChanged: false };
      }

      // Signalled rather than thrown: `withAuth` owns the `Set-Cookie` on this
      // response, and its commit would land after — and so override — a destroy.
      if (fresh.role !== user.role) return { user, roleChanged: true };

      session.markRoleChecked();
      // Same role, but the name or phone may have moved on.
      session.setUser(fresh);
      return { user: fresh, roleChanged: false };
    },
  );

  if (result.roleChanged) throw await signOutForRoleChange(request);

  // A toast left on a redirect. Reading it also clears it, so a message shows
  // once and never resurfaces on the next navigation.
  const toast = await readToast(request);
  const out = new Headers();
  if (headers?.["Set-Cookie"]) out.append("Set-Cookie", headers["Set-Cookie"]);
  if (toast) out.append("Set-Cookie", await clearToastCookie());

  // The header's date pill reads the branch's own clock, formatted on the
  // server so render and hydration cannot disagree about what day it is.
  const now = new Date();
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Accra",
    weekday: "long",
  }).format(now);
  const dayMonth = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Accra",
    day: "numeric",
    month: "short",
  }).format(now);

  return data(
    {
      user: result.user,
      sidebarOpen: readSidebarPreference(request),
      toast,
      dateLabel: `${weekday}, ${dayMonth}`,
      bell: await readBell(request, out),
    },
    { headers: out },
  );
}

/**
 * The few most recent notifications, for the header bell.
 *
 * Deliberately soft: the bell is furniture on every signed-in page, and a feed
 * that is slow or briefly unavailable must not take the whole app down with it.
 * A failure comes back as an empty bell, which is what an empty bell already
 * means to look at.
 *
 * Its `Set-Cookie` is appended to the same headers the role check wrote to, so
 * a token rotated by this call is not dropped.
 */
async function readBell(
  request: Request,
  out: Headers,
): Promise<{ unread: number; items: BellItem[] }> {
  try {
    const { data: feed, headers } = await withAuth(request, (token) =>
      listNotifications(token, { limit: BELL_LIMIT }),
    );
    if (headers?.["Set-Cookie"]) out.append("Set-Cookie", headers["Set-Cookie"]);

    return {
      unread: feed.unread,
      items: feed.items.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        unread: isUnread(n),
        to: linkFor(n),
        createdAt: n.createdAt,
      })),
    };
  } catch (error) {
    // A 401 is `withAuth`'s business — it renews and retries — so it is not
    // swallowed here. Everything else is the network, not the account.
    if (error instanceof ApiError && error.status === 401) throw error;
    return { unread: 0, items: [] };
  }
}

/** How many rows the bell holds. The rest are a click away on /notifications. */
const BELL_LIMIT = 6;

interface BellItem {
  id: string;
  title: string;
  body: string;
  unread: boolean;
  to: string | null;
  createdAt: string;
}

/**
 * The header bell: the unread count, the last few rows, and the way to the
 * rest.
 *
 * A notification is never a source of truth about money — the record it links
 * to is — so every row here is a way *to* a page rather than a figure to act
 * on. Rows the API could not give a destination stay unlinked instead of
 * pointing somewhere plausible.
 */
function NotificationBell({
  bell,
  dateLabel,
}: {
  bell: { unread: number; items: BellItem[] };
  dateLabel: string;
}) {
  const badge = badgeCount(bell.unread);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-full bg-secondary px-3.5 py-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        aria-label={
          bell.unread > 0
            ? `Notifications, ${formatCount(bell.unread)} unread`
            : "Notifications, none unread"
        }
      >
        <BellIcon className="size-3.5" />
        <span className="hidden sm:inline">{dateLabel}</span>
        {badge && <span className="text-brand-coral">({badge})</span>}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between gap-2 font-normal text-muted-foreground">
          <span>Notifications</span>
          {bell.unread > 0 && (
            <span className="text-brand-coral">
              {formatCount(bell.unread)} unread
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {bell.items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            Nothing yet.
          </p>
        ) : (
          bell.items.map((item) => {
            const row = (
              <>
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    item.unread ? "bg-brand-coral" : "bg-transparent",
                  )}
                />
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block truncate text-sm",
                      item.unread ? "font-medium" : "text-muted-foreground",
                    )}
                  >
                    {item.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.body}
                  </span>
                </span>
              </>
            );

            return (
              <DropdownMenuItem
                key={item.id}
                asChild={Boolean(item.to)}
                className="items-start gap-2"
              >
                {item.to ? <Link to={item.to}>{row}</Link> : <div>{row}</div>}
              </DropdownMenuItem>
            );
          })
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/notifications" className="justify-center text-sm font-medium">
            See all
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Fire the flash exactly once. Keyed on the message rather than on mount:
 * a second toast with the same text is a second event, and React re-running an
 * effect is not.
 */
function useFlashToast(toast: Toast | null) {
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const key = `${toast.tone}:${toast.message}:${toast.description ?? ""}`;
    if (shown.current === key) return;
    shown.current = key;
    sonner[toast.tone](toast.message, { description: toast.description });
  }, [toast]);
}

/**
 * What the header calls this page: the rail item it belongs to, or — for pages
 * with no item of their own — the `handle.title` the route exports.
 */
function useHeaderTitle(pathname: string): {
  title: string | undefined;
  description: string | undefined;
} {
  const matches = useMatches();
  const named = [...matches]
    .reverse()
    .find(
      (match): match is typeof match & { handle: { title: string; description?: string } } =>
        typeof (match.handle as { title?: unknown } | undefined)?.title === "string",
    );
  return {
    title: named?.handle.title ?? navItemFor(pathname)?.label,
    description:
      named?.handle.description ??
      (pathname === "/dashboard"
        ? "Manage, Monitor, and Optimize Yadah’s Banking Operations!"
        : undefined),
  };
}

/**
 * The rail writes its open state to a cookie. Reading it here means the server
 * renders the rail the way this person left it, instead of flashing wide.
 */
function readSidebarPreference(request: Request): boolean {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = /(?:^|;\s*)sidebar_state=(true|false)/.exec(cookie);
  return match ? match[1] === "true" : true;
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { user, sidebarOpen, toast, dateLabel, bell } = loaderData;
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLDivElement>(null);
  const { title, description } = useHeaderTitle(pathname);

  useFlashToast(toast);

  // `main` scrolls, not the window, so `ScrollRestoration` cannot reach it.
  // Send it back to the top on a route change.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={sidebarOpen} className="h-dvh overflow-hidden">
        <AppSidebar user={user} />

        <SidebarInset className="min-w-0 overflow-hidden">
          {/* The dashboard reference's header, on every page: trigger and
              title on the left, then the search, date and account pills. */}
          <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
            <SidebarTrigger className="shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <h1 className="truncate font-heading text-lg font-bold tracking-tight">
                {title}
              </h1>
              {description && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {description}
                </p>
              )}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2.5">
              {/* One global search: it looks a customer up, which is what the
                  counter reaches for most. Enter submits. */}
              <Form
                method="get"
                action="/customers"
                className="flex w-40 items-center gap-2 rounded-full bg-secondary px-3.5 py-2 focus-within:ring-2 focus-within:ring-ring/40 sm:w-56"
              >
                <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  type="search"
                  name="search"
                  placeholder="Search customers..."
                  className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
              </Form>

<NotificationBell bell={bell} dateLabel={dateLabel} />

              <ThemeToggle className="size-9 rounded-full bg-secondary text-foreground hover:bg-secondary/70" />
              <ProfileMenu user={user} compact />
            </div>
          </header>

          <div ref={mainRef} className="flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
