import type { ReactNode } from "react";

import type { RailSection } from "~/components/filter-rail";

/**
 * What an inventory page adds to the module's one side panel: its own search
 * box, its status views and its filters, seated in the panel the layout
 * already draws rather than in a second one beside it.
 */
export interface InventoryRailExtra {
  /** Above the module's own links — the search box. */
  header?: ReactNode;
  /** Further sections under the module's links — the status views. */
  sections?: RailSection[];
  /** Which of those views is open. */
  active?: string;
  /** Under everything — the page's other filters. */
  footer?: ReactNode;
  /** Under `lg`, where the panel is a strip: the same controls on one line. */
  strip?: ReactNode;
}

/** What the inventory layout hands its pages through the outlet. */
export interface InventoryOutletContext {
  setRailExtra: (extra: InventoryRailExtra | null) => void;
}
