import {
  BoxesIcon,
  PackageXIcon,
  ShapesIcon,
  TagIcon,
  WarehouseIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Outlet } from "react-router";

import { FilterRail, RailFrame, type RailSection } from "~/components/filter-rail";
import type { InventoryOutletContext, InventoryRailExtra } from "~/lib/inventory-rail";

/**
 * The frame the inventory pages sit in: the shelf, what has been written off
 * it, and the two lists everything on it is filed under. The rail is what makes them one place —
 * from the products, the brands are one click away, and the one you are in
 * is lit.
 *
 * It is the module's only side panel. A page with filters of its own — the
 * shelf's search, status views and narrowing — hands them up through the
 * outlet and they are seated here, under the module's links, rather than in a
 * second panel beside this one.
 *
 * No `handle` of its own, so the header keeps reading the child's title, and
 * no loader, so switching costs only the page's own query.
 */
export default function InventoryLayout() {
  const [extra, setExtra] = useState<InventoryRailExtra | null>(null);
  const context = useMemo<InventoryOutletContext>(() => ({ setRailExtra: setExtra }), []);

  return (
    <RailFrame
      rail={({ horizontal }) =>
        horizontal ? (
          <div className="space-y-3">
            <FilterRail label="Inventory" sections={SECTIONS} horizontal />
            {extra?.strip}
            {extra?.sections && (
              <FilterRail
                label="Filter this list"
                sections={extra.sections}
                active={extra.active}
                horizontal
              />
            )}
          </div>
        ) : extra ? (
          <FilterRail
            label="Inventory"
            sections={[...SECTIONS, ...(extra.sections ?? [])]}
            // A page that adds views is the shelf: light it, and its open view.
            active={["products", extra.active ?? ""]}
            header={extra.header}
            footer={extra.footer}
          />
        ) : (
          <FilterRail label="Inventory" sections={SECTIONS} />
        )
      }
    >
      <Outlet context={context} />
    </RailFrame>
  );
}

const SECTIONS: RailSection[] = [
  {
    label: "Shelf",
    icon: WarehouseIcon,
    items: [
      // Only the shelf must match exactly; `/inventory/new` is still the shelf.
      { key: "products", to: "/inventory", label: "Products", icon: BoxesIcon, end: true },
      // Stock that left the shelf without being sold. It belongs beside the
      // shelf rather than in the books: the person who notices a broken item
      // is standing in front of it.
      { key: "damages", to: "/inventory/damages", label: "Damages", icon: PackageXIcon },
    ],
  },
  {
    label: "Filed under",
    icon: TagIcon,
    items: [
      { key: "categories", to: "/inventory/categories", label: "Categories", icon: ShapesIcon },
      { key: "brands", to: "/inventory/brands", label: "Brands", icon: TagIcon },
    ],
  },
];
