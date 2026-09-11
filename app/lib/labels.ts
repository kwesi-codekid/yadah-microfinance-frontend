import { ShapesIcon, TagIcon } from "lucide-react";

import type { HpItem, ItemLabel, LabelKind } from "~/lib/hire-purchase";

/**
 * Brands and categories as the pages see them: the words for each kind, and
 * the shapes the loaders hand the components. Client-safe — no API client, no
 * `.server` imports — so both halves can read it.
 */

export const LABEL_COPY: Record<
  LabelKind,
  { one: string; many: string; Many: string; path: string; icon: typeof TagIcon }
> = {
  brand: { one: "brand", many: "brands", Many: "Brands", path: "/inventory/brands", icon: TagIcon },
  category: {
    one: "category",
    many: "categories",
    Many: "Categories",
    path: "/inventory/categories",
    icon: ShapesIcon,
  },
};

export const LABEL_PAGE_SIZE = 25;

export interface LabelListData {
  kind: LabelKind;
  canDelete: boolean;
  search: string;
  page: number;
  total: number;
  rows: ItemLabel[];
}

export interface LabelDetailData {
  kind: LabelKind;
  label: ItemLabel;
  items: {
    id: string;
    name: string;
    detail: string;
    quantityInStock: number;
    sellingPrice: number;
    status: HpItem["status"];
    sellable: boolean;
  }[];
}

export interface LabelFormData {
  kind: LabelKind;
  /** Null when adding. */
  label: ItemLabel | null;
}

export interface LabelActionResult {
  ok: boolean;
  message: string;
}

export function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
