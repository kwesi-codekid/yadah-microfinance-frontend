import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { type AuthUser } from "~/lib/auth-client";
import { visibleNavItems, type NavItem } from "./nav-items";

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
        "flex h-full flex-col border-r-2 border-border bg-surface text-foreground transition-[width] duration-200 shadow-none",
        collapsed ? "w-16" : "w-56",
        className,
      ].join(" ")}
    >
      {/* h-12, no top margin: this rule has to line up with the header's bottom border. */}
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
          <span className="truncate font-heading font-bold text-success">
            YADAH DYNAMICS
          </span>
        )}
      </div>

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

function RailTooltip({ children }: { children: ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border-2 border-border bg-surface px-2 py-1 text-xs font-medium text-foreground opacity-0 shadow-none transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {children}
    </span>
  );
}
