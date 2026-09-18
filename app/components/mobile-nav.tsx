import { LayoutGridIcon } from "lucide-react";
import { useState } from "react";
import { NavLink, useLocation } from "react-router";

import {
  isNavItemActive,
  NAV,
  visibleNavItems,
  type NavItem,
} from "~/components/nav-items";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import type { AuthUser } from "~/lib/auth";
import { cn } from "~/lib/utils";

/** The modules on the bar, left to right. Everything else is behind "More". */
const PINNED = ["/dashboard", "/customers", "/susu", "/savings"];

/** The bar has five slots: the pinned modules and "More". */
const SLOTS = 5;

/** Width of the hump the bar's top edge makes over the current slot. */
const HUMP = 44;

/**
 * The phone's version of the rail: a rounded bar floating inside the page,
 * five slots wide. The current module is marked in place — a filled icon, a
 * coloured label, and a small dark hump rising out of the bar's top edge
 * above it — the way the reference does it. "More" opens the rest of the
 * modules as a sheet from the bottom, laid out the same way. Only rendered
 * below `md`; the rail itself takes over from there.
 */
export function MobileNav({ user }: { user: AuthUser }) {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const visible = visibleNavItems(user);
  const pinned = PINNED.map((to) => NAV.find((i) => i.to === to)!).filter((i) =>
    visible.includes(i),
  );
  const rest = visible.filter((i) => !pinned.includes(i));

  const pinnedIndex = pinned.findIndex((i) => isNavItemActive(pathname, i));
  const moreActive =
    pinnedIndex < 0 && rest.some((i) => isNavItemActive(pathname, i));
  // The slot the hump sits over; none on a page outside every module.
  const activeIndex =
    pinnedIndex >= 0 ? pinnedIndex : moreActive ? SLOTS - 1 : -1;

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 md:hidden"
      >
        {/* The shadow is a filter on a wrapper so the hump, which overflows
            the bar, casts one too. */}
        <div className="relative drop-shadow-[0_4px_14px_rgba(0,0,0,0.12)] dark:drop-shadow-[0_4px_14px_rgba(0,0,0,0.5)]">
          <div className="relative rounded-2xl bg-card">
            <ul
              className="grid h-15"
              style={{ gridTemplateColumns: `repeat(${SLOTS}, 1fr)` }}
            >
              {pinned.map((item) => (
                <Tab key={item.to} item={item} />
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => setMoreOpen(true)}
                  aria-expanded={moreOpen}
                  className={cn(
                    tabClass,
                    moreActive ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <LayoutGridIcon
                    className="size-5.5"
                    strokeWidth={moreActive ? 2.2 : 1.8}
                    fill={moreActive ? "currentColor" : "none"}
                    fillOpacity={moreActive ? 0.2 : 0}
                  />
                  <span
                    className={cn(labelClass, moreActive && "font-semibold")}
                  >
                    More
                  </span>
                </button>
              </li>
            </ul>
          </div>
          {/* The hump: a dark half-disc rising out of the bar's top edge over
              the current slot. It lives beside the bar rather than inside it
              so it can overflow the edge, and it slides along when the page
              changes. */}
          {activeIndex >= 0 && (
            <div
              aria-hidden
              className="absolute -top-2 z-10 h-4 bg-brand-navy transition-[left] duration-300 ease-[cubic-bezier(.4,0,.2,1)]"
              style={{
                width: HUMP,
                borderRadius: "50% 50% 0 0 / 100% 100% 0 0",
                left: `calc(${((activeIndex + 0.5) * 100) / SLOTS}% - ${HUMP / 2}px)`,
              }}
            />
          )}
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:hidden"
        >
          <div
            aria-hidden
            className="mx-auto h-1 w-10 rounded-full bg-border"
          />
          <SheetHeader className="p-0 pt-2 text-center">
            <SheetTitle className="text-sm font-semibold">
              All modules
            </SheetTitle>
            <SheetDescription className="sr-only">
              The rest of the navigation.
            </SheetDescription>
          </SheetHeader>
          <ul className="grid grid-cols-4 gap-1">
            {rest.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex flex-col items-center gap-1.5 rounded-xl px-1 py-3 outline-none focus-visible:bg-accent",
                      isActive ? "text-primary" : "text-muted-foreground",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={cn(
                          "flex size-11 items-center justify-center rounded-full",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary",
                        )}
                      >
                        <item.icon
                          className="size-5.5"
                          strokeWidth={isActive ? 2.2 : 1.8}
                        />
                      </span>
                      <span
                        className={cn(
                          labelClass,
                          "text-center",
                          isActive && "font-semibold",
                        )}
                      >
                        {item.label}
                      </span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}

const tabClass =
  "flex h-15 w-full flex-col items-center justify-center gap-1 outline-none focus-visible:bg-accent/60";
const labelClass = "text-[10px] leading-none font-medium";

/**
 * One slot. The current module is marked in place: the icon fills and the
 * label takes the primary colour.
 */
function Tab({ item }: { item: NavItem }) {
  return (
    <li>
      <NavLink
        to={item.to}
        end={item.end}
        className={({ isActive }) =>
          cn(tabClass, isActive ? "text-primary" : "text-muted-foreground")
        }
      >
        {({ isActive }) => (
          <>
            <item.icon
              className="size-5.5"
              strokeWidth={isActive ? 2.2 : 1.8}
              fill={isActive ? "currentColor" : "none"}
              fillOpacity={isActive ? 0.2 : 0}
            />
            <span className={cn(labelClass, isActive && "font-semibold")}>
              {item.label}
            </span>
          </>
        )}
      </NavLink>
    </li>
  );
}
