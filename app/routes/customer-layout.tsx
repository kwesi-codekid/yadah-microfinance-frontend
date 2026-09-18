import {
  BanknoteIcon,
  IdCardIcon,
  LandmarkIcon,
  PiggyBankIcon,
  ReceiptTextIcon,
  WalletIcon,
} from "lucide-react";
import { Outlet, useParams } from "react-router";

import { FilterRail, RailFrame, type RailSection } from "~/components/filter-rail";
import { isCounter } from "~/lib/auth";
import { useCurrentUser } from "~/lib/use-current-user";

/**
 * The frame a customer's three pages sit in: who they are, what they hold, and
 * everything that has moved.
 *
 * The rail exists because of what the counter was doing without it. To take a
 * deposit you had to leave the customer, open the susu or savings listing,
 * search for them again, and find the right account — every time. Their
 * holdings are a property of the customer, so they belong one click from the
 * customer, and each row links straight to the page where the money is taken.
 *
 * No `handle` of its own, so the header keeps reading the child's title, and no
 * loader, so switching costs only the page's own query — the rail is built from
 * the id in the URL and needs nothing fetched.
 */
export default function CustomerLayout() {
  const { id } = useParams();
  const user = useCurrentUser();

  // A collector may read the customers on their own round, but the holdings
  // and the ledger both come from the counter-only statement endpoint. Drawing
  // links that would bounce them is worse than not drawing them.
  const sections: RailSection[] = [
    {
      label: "Customer",
      icon: IdCardIcon,
      items: [
        // Only the record itself matches exactly; the drawer over it at
        // `/customers/:id/collector` is still the record.
        {
          key: "details",
          to: `/customers/${id}`,
          label: "Details",
          icon: IdCardIcon,
          end: true,
        },
      ],
    },
    ...(isCounter(user)
      ? [
          {
            // One product per item rather than a single "Accounts" page: the
            // counter works on one product at a time, and a rail that names
            // them is a rail you can aim at without reading.
            label: "Holdings",
            icon: WalletIcon,
            items: [
              {
                key: "susu",
                to: `/customers/${id}/susu`,
                label: "Susu",
                icon: PiggyBankIcon,
              },
              {
                key: "savings",
                to: `/customers/${id}/savings`,
                label: "Savings",
                icon: BanknoteIcon,
              },
              {
                key: "loans",
                to: `/customers/${id}/loans`,
                label: "Loans",
                icon: LandmarkIcon,
              },
              {
                key: "hire-purchase",
                to: `/customers/${id}/hire-purchase`,
                label: "Hire purchase",
                icon: ReceiptTextIcon,
              },
            ],
          },
          {
            label: "History",
            icon: ReceiptTextIcon,
            items: [
              {
                key: "transactions",
                to: `/customers/${id}/statement`,
                label: "Transactions",
                icon: ReceiptTextIcon,
              },
            ],
          },
        ]
      : []),
  ];

  return (
    <RailFrame
      rail={({ horizontal }) => (
        <FilterRail label="Customer" sections={sections} horizontal={horizontal} />
      )}
    >
      <Outlet />
    </RailFrame>
  );
}
