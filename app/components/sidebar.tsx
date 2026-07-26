import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { type AuthUser } from "~/lib/auth-client";
import { visibleNavItems, type NavItem } from "./nav-items";

/**
 * Collapsible dashboard side navigation. Expanded shows icon + label; the
 * toggle collapses it to an icon-only rail (labels become hover tooltips).
 * Destinations, role gating and the exclusion of unbuilt sections all live in
 * `nav-items.ts`, shared with the mobile tab bar.
 *
 * Desktop only — below `lg` the layout hides this and renders `<MobileNav>`.
 */

export function Sidebar({
  collapsed,
  user,
  className = "",
}: {
  collapsed: boolean;
  user: AuthUser | null;
  className?: string;
}) {
  const items = visibleNavItems(user);

  return (
    <aside
      className={[
        "flex h-screen flex-col border-r-2 border-border bg-surface text-foreground transition-[width] duration-200 shadow-none",
        collapsed ? "w-16" : "w-56",
        className,
      ].join(" ")}
    >
      {/* Brand */}
      <div
        className={[
          "flex h-12 shrink-0 items-center gap-2 border-b-2 border-border px-3",
          collapsed ? "justify-center" : "",
        ].join(" ")}
      >
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success/10"
          aria-hidden="true"
        >
          <img src="/favicon.png" alt="" className="size-5" />
        </span>
        {!collapsed && (
          <span className="truncate font-heading font-bold ">
            YADAH
          </span>
        )}
      </div>

      {/* Nav — vertically centered in the available space. Overflow stays
          visible so a collapsed item's hover label can escape the rail. */}
      <nav className="flex flex-1 flex-col justify-center gap-1 p-2">
        {items.map((item) => (
          <ActiveItem key={item.to} item={item} collapsed={collapsed} />
        ))}
      </nav>

    </aside>
  );
}

function ActiveItem({
  item,
  collapsed,
}: {
  item: NavItem;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        [
          "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
          collapsed ? "justify-center" : "",
          isActive
            ? "bg-success/20 font-semibold text-success dark:text-success/30"
            : "text-muted hover:bg-surface-secondary hover:text-foreground",
        ].join(" ")
      }
    >
      <Icon size={18} className="shrink-0" />
      {collapsed ? (
        <RailTooltip>{item.label}</RailTooltip>
      ) : (
        <span className="truncate">{item.label}</span>
      )}
    </NavLink>
  );
}

/**
 * The label a collapsed item shows on hover, as a flyout to the right of the
 * icon. Replaces the native `title` tooltip, which is slow to appear and can't
 * be themed. It stays in the DOM at `opacity-0` rather than being conditionally
 * rendered, so it still supplies the item's accessible name while collapsed.
 *
 * `pointer-events-none` keeps it from swallowing the click aimed at the icon
 * once it has faded in over the content beside the rail.
 */
function RailTooltip({ children }: { children: ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border-2 border-border bg-surface px-2 py-1 text-xs font-medium text-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {children}
    </span>
  );
}
