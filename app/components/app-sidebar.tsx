import { NavLink, useLocation } from "react-router";

import { BrandMark } from "~/components/brand";
import { isNavItemActive, visibleNavItems } from "~/components/nav-items";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "~/components/ui/sidebar";
import type { AuthUser } from "~/lib/auth";

/**
 * The module rail. Navy in both themes — it is the strongest brand surface in
 * the app — with the current module marked in gold.
 */
export function AppSidebar({ user }: { user: AuthUser }) {
  const { pathname } = useLocation();
  const { setOpenMobile, isMobile } = useSidebar();
  const items = visibleNavItems(user);

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border px-3 group-data-[collapsible=icon]:px-1.5">
        <NavLink
          to="/dashboard"
          className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <BrandMark className="size-9 group-data-[collapsible=icon]:size-8" />
          <span className="flex flex-col gap-0.5 group-data-[collapsible=icon]:hidden">
            <span className="font-heading text-sm leading-none font-bold tracking-tight text-sidebar-primary">
              YADAH
            </span>
            <span className="font-heading text-[0.6rem] leading-none font-semibold tracking-[0.18em] text-sidebar-foreground/60 uppercase">
              Dynamic Enterprise
            </span>
          </span>
        </NavLink>
      </SidebarHeader>

      <SidebarContent>
        {/* my-auto, not justify-center: the group sits in the vertical middle
            of the rail, but the margins collapse if the list ever outgrows the
            rail, so the top item stays reachable and scroll still works. */}
        <SidebarGroup className="my-auto">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {items.map((item) => {
                const active = isNavItemActive(pathname, item);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      // Active is the one loud note on the green rail: a solid
                      // pale-mint pill with deep-green text. The `data-active:hover`
                      // pair pins the pill so a hover can't flip it back to green.
                      className="h-9 data-active:bg-sidebar-primary data-active:font-semibold data-active:text-sidebar-primary-foreground data-active:hover:bg-sidebar-primary data-active:hover:text-sidebar-primary-foreground"
                    >
                      <NavLink
                        to={item.to}
                        end={item.end}
                        // The mobile rail is a sheet: choosing a module closes it.
                        onClick={() => isMobile && setOpenMobile(false)}
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
