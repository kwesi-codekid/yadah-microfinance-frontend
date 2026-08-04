import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { Ellipsis } from "lucide-react";
import { SideDrawer } from "~/components/side-drawer";
import { type AuthUser } from "~/lib/auth-client";
import { isNavItemActive, splitNavItems, type NavItem } from "./nav-items";

/** Keeps every cell 44px tall, so the bar's own height doesn't move. */
const ITEM_CLASS =
  "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 transition-colors";

const LABEL_CLASS = "max-w-full truncate text-[10px] font-medium leading-none";

export function MobileNav({ user }: { user: AuthUser | null }) {
  const { primary, overflow } = splitNavItems(user);
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  // Landing somewhere new means the sheet has done its job.
  useEffect(() => setOpen(false), [pathname]);

  // What More stands in for, so the bar still says where you are.
  const current = overflow.find((item) => isNavItemActive(pathname, item));

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex items-stretch gap-1 rounded-xl border-2 border-border bg-surface p-1.5 shadow-none lg:hidden"
      >
        {primary.map((item) => (
          <Tab key={item.to} item={item} />
        ))}

        {overflow.length > 0 && (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={current ? `More, ${current.label} selected` : "More"}
            onClick={() => setOpen(true)}
            className={`${ITEM_CLASS} ${
              current ? "bg-success/20 text-success" : "text-muted"
            }`}
          >
            {current ? (
              <current.icon size={20} className="shrink-0" />
            ) : (
              <Ellipsis size={20} className="shrink-0" />
            )}
            <span className={LABEL_CLASS}>{current?.label ?? "More"}</span>
          </button>
        )}
      </nav>

      <SideDrawer
        isOpen={open}
        onClose={() => setOpen(false)}
        position="bottom"
        title="More"
      >
        <ul className="grid grid-cols-3 gap-2">
          {overflow.map((item) => {
            const Icon = item.icon;
            const active = isNavItemActive(pathname, item);
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={() => setOpen(false)}
                  className={`flex h-full flex-col items-center justify-center gap-2 rounded-lg border-2 p-3 text-center transition-colors ${
                    active
                      ? "border-success bg-success/10 text-success"
                      : "border-border text-muted hover:border-success/50 hover:text-foreground"
                  }`}
                >
                  <Icon size={22} className="shrink-0" />
                  <span className="text-xs font-medium leading-tight">
                    {item.label}
                  </span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </SideDrawer>
    </>
  );
}

/** One destination. Only live sections reach this — see the filter above. */
function Tab({ item }: { item: NavItem }) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        [
          ITEM_CLASS,
          isActive ? "bg-success/20 text-success" : "text-muted",
        ].join(" ")
      }
    >
      <Icon size={20} className="shrink-0" />
      <span className={LABEL_CLASS}>{item.label}</span>
    </NavLink>
  );
}
