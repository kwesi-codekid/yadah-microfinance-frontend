import { BellIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { data, Form, Link, Outlet, useLocation, useMatches } from "react-router";
import { toast as sonner } from "sonner";

import * as authApi from "~/api/auth";
import { ApiError } from "~/api/error";
import { AppSidebar } from "~/components/app-sidebar";
import { navItemFor } from "~/components/nav-items";
import { ProfileMenu } from "~/components/profile-menu";
import { ThemeToggle } from "~/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/ui/sidebar";
import { TooltipProvider } from "~/components/ui/tooltip";
import type { AuthUser } from "~/lib/auth";
import { requireUser, signOutForRoleChange, withAuth } from "~/lib/session.server";
import { clearToastCookie, readToast, type Toast } from "~/lib/toast.server";
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
    },
    { headers: out },
  );
}

/** SAMPLE — the notifications feed is not built yet; these rows link to the
 *  screens the real ones will. */
const NOTIFICATIONS = [
  { title: "9 credit accounts in arrears — review the aging report", to: "/reports/loans" },
  { title: "14 susu payouts awaiting approval", to: "/susu/summary" },
  { title: "Yesterday's collections report is ready", to: "/reports/collections" },
];

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
function useHeaderTitle(pathname: string): string | undefined {
  const matches = useMatches();
  const named = [...matches]
    .reverse()
    .find(
      (match): match is typeof match & { handle: { title: string } } =>
        typeof (match.handle as { title?: unknown } | undefined)?.title === "string",
    );
  return named?.handle.title ?? navItemFor(pathname)?.label;
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
  const { user, sidebarOpen, toast, dateLabel } = loaderData;
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLDivElement>(null);
  const title = useHeaderTitle(pathname);

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
              {pathname === "/dashboard" && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  Manage, Monitor, and Optimize Yadah&rsquo;s Banking Operations!
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

              <DropdownMenu>
                <DropdownMenuTrigger
                  className="flex items-center gap-2 rounded-full bg-secondary px-3.5 py-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  aria-label={`Notifications, ${NOTIFICATIONS.length} unread`}
                >
                  <BellIcon className="size-3.5" />
                  <span className="hidden sm:inline">{dateLabel}</span>
                  <span className="text-brand-coral">({NOTIFICATIONS.length})</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  {NOTIFICATIONS.map((item) => (
                    <DropdownMenuItem key={item.title} asChild>
                      <Link to={item.to}>
                        <span className="size-1.5 shrink-0 rounded-full bg-brand-coral" />
                        {item.title}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

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
