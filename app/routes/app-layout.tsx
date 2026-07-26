import { useEffect, useState } from "react";
import { Form, Outlet, useLoaderData } from "react-router";
import { Popover } from "@heroui/react";
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen, User } from "lucide-react";
import type { Route } from "./+types/app-layout";
import { Sidebar } from "~/components/sidebar";
import { MobileNav } from "~/components/mobile-nav";
import { ThemeToggle } from "~/components/theme-toggle";
import { ROLE_LABELS } from "~/lib/auth-client";
import { requireUser } from "~/lib/session.server";

const COLLAPSE_KEY = "yadah.sidebarCollapsed";

/**
 * Authenticated app chrome: a collapsible side nav + top bar around the routed
 * page content. Shared by every signed-in page (not admin-only). Auth is
 * enforced here in the loader, so nested routes can assume a user.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return { user };
}

export default function AppLayout() {
  const { user } = useLoaderData<typeof loader>();
  // Default to the small collapsed rail; a stored preference overrides it.
  const [collapsed, setCollapsed] = useState(true);

  // Restore the persisted collapse preference on mount (client only).
  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSE_KEY);
    if (stored !== null) setCollapsed(stored === "true");
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_KEY, String(next));
      return next;
    });
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      {/* Desktop rail; below lg the bottom tab bar takes over. */}
      <Sidebar collapsed={collapsed} user={user} className="hidden lg:flex" />

      {/* White, so the grey panel below can round its top-left corner against
          something. The rail, this column and the bar are all one continuous
          white shell; the only thing that reads as a separate surface is the
          content panel. */}
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        {/* No bottom border: the grey panel's edge is the separation, and a
            line here would cut straight across its rounded corner. */}
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 bg-surface px-6 shadow-none">
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground lg:flex"
          >
            {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
          </button>

          {/* The rail carries the brand on desktop; on mobile it lives here. */}
          <span className="flex items-center gap-2 lg:hidden">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success/10"
              aria-hidden="true"
            >
              <img src="/favicon.png" alt="" className="size-5" />
            </span>
            <span className="truncate font-sans font-extrabold tracking-tight">
              YADAH
            </span>
          </span>

          <div className="ml-auto flex items-center gap-3 text-sm!">
            <ThemeToggle />
            <UserMenu  name={user.name} role={ROLE_LABELS[user.role]} />
          </div>
        </header>
        {/* The grey canvas, inset into the white shell as a rounded panel with
            no border. The corner is what marks the boundary — a hairline there
            would only draw the eye to the seam. Rounded from `lg` up, where
            the rail gives it a left edge to turn against; on mobile the panel
            runs to the viewport edge and a corner there is a notch out of
            nothing. Bottom padding clears the floating tab bar. */}
        <main className="flex-1 overflow-y-auto bg-background pb-24 lg:rounded-tl-lg lg:pb-0">
          <Outlet />
        </main>
      </div>

      <MobileNav user={user} />
    </div>
  );
}

const MENU_ITEM =
  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-success/20";

/**
 * User chip + dropdown, on HeroUI's `Popover` — react-aria handles outside
 * clicks, Escape, focus trapping and placement, so none of that is hand-rolled
 * here. "Logout" posts to the /logout action (server-side).
 */
function UserMenu({ name, role }: { name: string; role: string }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Popover>
      {/* Renders its own pressable element, so the chip's markup goes straight
          in — a nested <button> here would be an interactive-in-interactive. */}
      <Popover.Trigger className="flex cursor-pointer items-center gap-2 rounded-full py-1 pl-1 pr-2 text-sm transition-colors hover:bg-success/10 hover:text-success dark:hover:bg-success/20">
        <span className="flex size-8 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand-dark dark:bg-white/10 dark:text-brand-light">
          {initials}
        </span>
        <span className="hidden text-left  sm:block">
          <span className="block max-w-40 truncate text-xs font-sans">
            {name}
          </span>
          <span className="block text-xs text-muted">{role}</span>
        </span>
        <ChevronDown size={16} className="text-muted" />
      </Popover.Trigger>

      <Popover.Content
        placement="bottom end"
        className="w-44 rounded-lg border-2 border-border bg-overlay p-1 shadow-none"
      >
        <Popover.Dialog className="outline-none">
          <button type="button" className={MENU_ITEM}>
            <User size={16} />
            Profile
          </button>
          <Form method="post" action="/logout">
            <button type="submit" className={MENU_ITEM}>
              <LogOut size={16} />
              Logout
            </button>
          </Form>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
