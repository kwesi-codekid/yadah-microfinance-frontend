import { NavLink } from "react-router";
import { type AuthUser } from "~/lib/auth-client";
import { visibleNavItems, type NavItem } from "./nav-items";

const ITEM_CLASS =
  "flex flex-1 items-center justify-center rounded-lg px-1 py-2.5 transition-colors";

export function MobileNav({ user }: { user: AuthUser | null }) {
  const items = visibleNavItems(user);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex items-stretch gap-1 rounded-xl border-2 border-border bg-surface p-1.5 shadow-none lg:hidden "
    >
      {items.map((item) => (
        <Tab key={item.to} item={item} />
      ))}
    </nav>
  );
}

/** One destination. Only live sections reach this — see the filter above. */
function Tab({ item }: { item: NavItem }) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      end={item.end}
      aria-label={item.label}
      className={({ isActive }) =>
        [
          ITEM_CLASS,
          isActive ? "bg-success/20 text-success" : "text-muted",
        ].join(" ")
      }
    >
      <Icon size={24} className="shrink-0" />
    </NavLink>
  );
}
