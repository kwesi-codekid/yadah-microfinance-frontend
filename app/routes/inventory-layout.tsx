import { BoxesIcon, ShapesIcon, TagIcon, WarehouseIcon } from "lucide-react";
import { Outlet } from "react-router";

import { FilterRail, RailFrame, type RailSection } from "~/components/filter-rail";

/**
 * The frame the inventory pages sit in: the shelf itself, and the two lists
 * everything on it is filed under. The rail is what makes them one place —
 * from the products, the brands are one click away, and the one you are in
 * is lit.
 *
 * No `handle` of its own, so the header keeps reading the child's title, and
 * no loader, so switching costs only the page's own query.
 */
export default function InventoryLayout() {
  return (
    <RailFrame
      rail={({ horizontal }) => (
        <FilterRail label="Inventory" sections={SECTIONS} horizontal={horizontal} />
      )}
    >
      <Outlet />
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
