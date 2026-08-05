import { data, Outlet, useLocation } from "react-router";
import { HandCoins, Package, UserCog } from "lucide-react";
import type { Route } from "./+types/settings";
import { TabLink, TabList } from "~/components/tabs";
import { isOffice, requireUser } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Settings · YADAH Dynamic Enterprise" }];
}

const PANEL_ID = "settings-panel";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  // Only the office may read or write the product settings.
  return data({ canManage: isOffice(user) });
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { canManage } = loaderData;
  const { pathname } = useLocation();

  const tabs = [
    {
      to: "/settings",
      label: "Your account",
      end: true,
      icon: <UserCog size={15} />,
    },
    ...(canManage
      ? [
          {
            to: "/settings/loans",
            label: "Loans",
            end: false,
            icon: <HandCoins size={15} />,
          },
          {
            to: "/settings/hire-purchase",
            label: "Hire purchase",
            end: false,
            icon: <Package size={15} />,
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="mb-5">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted">
          Your own account, and the numbers every new loan and agreement is
          quoted at.
        </p>
      </div>

      <TabList label="Settings" className="mb-6 max-w-full overflow-x-auto">
        {tabs.map((tab) => (
          <TabLink
            key={tab.to}
            to={tab.to}
            selected={tab.end ? pathname === tab.to : pathname.startsWith(tab.to)}
            controls={PANEL_ID}
            icon={tab.icon}
          >
            {tab.label}
          </TabLink>
        ))}
      </TabList>

      <div id={PANEL_ID}>
        <Outlet />
      </div>
    </div>
  );
}
