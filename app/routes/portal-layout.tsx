import {
  ArrowLeftRightIcon,
  BanknoteArrowUpIcon,
  FileTextIcon,
  LogOutIcon,
  SmartphoneIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { data, Form, NavLink, Outlet, useLocation } from "react-router";
import { toast as sonner } from "sonner";

import { BrandLockup } from "~/components/brand";
import { ThemeToggle } from "~/components/theme-toggle";
import { Button } from "~/components/ui/button";
import { InitialsDisc } from "~/components/ui/data-table";
import { TooltipProvider } from "~/components/ui/tooltip";
import { initialsOf } from "~/lib/auth";
import { requireCustomer } from "~/lib/portal-session.server";
import { clearToastCookie, readToast, type Toast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/portal-layout";

/**
 * The customer's frame. No rail — a customer has five places to be and a
 * phone in their hand — so the navigation is a row of tabs under a slim
 * header, the same navy the staff app wears, and the pages below use the
 * same cards and figures the office sees.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const customer = await requireCustomer(request);
  const toast = await readToast(request);
  const headers = new Headers();
  if (toast) headers.append("Set-Cookie", await clearToastCookie());
  return data({ customer, toast }, { headers });
}

const TABS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/portal", label: "Accounts", icon: WalletIcon, end: true },
  { to: "/portal/transactions", label: "Transactions", icon: ArrowLeftRightIcon },
  { to: "/portal/statement", label: "Statement", icon: FileTextIcon },
  { to: "/portal/pay", label: "Pay in", icon: SmartphoneIcon },
  { to: "/portal/requests", label: "Withdrawals", icon: BanknoteArrowUpIcon },
];

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

export default function PortalLayout({ loaderData }: Route.ComponentProps) {
  const { customer, toast } = loaderData;
  const { pathname } = useLocation();
  useFlashToast(toast);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-background text-foreground">
        <header className="bg-brand-navy text-white">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
            <BrandLockup tone="light" />
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle className="text-white hover:bg-white/10 hover:text-white" />
              <div className="hidden items-center gap-2 sm:flex">
                {customer.photoUrl ? (
                  <img src={customer.photoUrl} alt="" className="size-8 rounded-full object-cover" />
                ) : (
                  <InitialsDisc initials={initialsOf(customer.fullName)} tint={customer.id} />
                )}
                <div className="leading-tight">
                  <p className="text-sm font-medium">{customer.fullName}</p>
                  <p className="text-[11px] text-white/60">{customer.phone}</p>
                </div>
              </div>
              <Form method="post" action="/portal/logout">
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="text-white/80 hover:bg-white/10 hover:text-white"
                >
                  <LogOutIcon />
                  <span className="hidden sm:inline">Sign out</span>
                </Button>
              </Form>
            </div>
          </div>

          <nav className="mx-auto max-w-5xl overflow-x-auto px-2 sm:px-4" aria-label="Portal">
            <ul className="flex gap-1">
              {TABS.map((tab) => (
                <li key={tab.to}>
                  <NavLink
                    to={tab.to}
                    end={tab.end}
                    prefetch="intent"
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
                        isActive
                          ? "border-brand-coral text-white"
                          : "border-transparent text-white/60 hover:text-white",
                      )
                    }
                  >
                    <tab.icon className="size-4" />
                    {tab.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
          <Outlet />
        </main>

        <footer className="mx-auto max-w-5xl px-4 pb-8 text-[11px] text-muted-foreground sm:px-6">
          Yadah Dynamic Enterprise · Ghana. Money is shown in cedis. Withdrawals are paid
          once the office approves them.
        </footer>
      </div>
    </TooltipProvider>
  );
}
