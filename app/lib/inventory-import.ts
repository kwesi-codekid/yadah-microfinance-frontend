/**
 * Stocking the shelf from a spreadsheet: the columns, and the checks the
 * preview screen can answer on its own.
 *
 * The API is the authority — it re-checks every row on submit, and only it
 * can say whether an item is already stocked. What lives here is the half that
 * needs no round trip: required cells, numbers that are not numbers, a selling
 * price under cost, a brand or category nobody has added, and the same item
 * twice in one sheet.
 *
 * Client-safe: no `.server` imports. Fetching lives in `~/api/hire-purchase`.
 */

import type { SheetColumnSpec, SheetIssue, SheetRow } from "~/components/import-sheet";
import { parseCedis } from "~/lib/format";

export const IMPORT_FIELDS = [
  "name",
  "brand",
  "category",
  "description",
  "condition",
  "quantityInStock",
  "costPrice",
  "sellingPrice",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportColumn = SheetColumnSpec<ImportField>;
export type RowIssue = SheetIssue<ImportField>;

export interface ImportRow extends SheetRow<ImportField> {
  /** Resolved from the brand cell; empty when it matched nothing. */
  brandId: string;
  /** Resolved from the category cell; empty when it matched nothing. */
  categoryId: string;
}

export interface LabelOption {
  id: string;
  name: string;
}

export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  { field: "name", header: "Item", required: true, input: "text", width: "w-56" },
  /** Drawn by the page: pickers over the managed brands and categories. */
  { field: "brand", header: "Brand", input: "custom", width: "w-40" },
  { field: "category", header: "Category", input: "custom", width: "w-40" },
  { field: "description", header: "Description", input: "text", width: "w-56" },
  {
    field: "condition",
    header: "Condition",
    input: "select",
    options: [
      { value: "new", label: "New" },
      { value: "used", label: "Used" },
    ],
    width: "w-28",
  },
  { field: "quantityInStock", header: "Quantity", required: true, input: "number", width: "w-24" },
  { field: "costPrice", header: "Cost · GH₵", required: true, input: "money", width: "w-32" },
  { field: "sellingPrice", header: "Price · GH₵", required: true, input: "money", width: "w-32" },
];

/** `POST /hire-purchase/items/import/preview` */
export interface ImportPreview {
  rows: {
    row: number;
    values: Partial<Record<ImportField, string>>;
    brandId: string;
    categoryId: string;
    issues: RowIssue[];
  }[];
  unknownHeaders: string[];
  brands: LabelOption[];
  categories: LabelOption[];
  counts: { total: number; ready: number; blocked: number };
}

/** `POST /hire-purchase/items/import` */
export interface ImportOutcome {
  created: { row: number; id: string; name: string }[];
  failed: { row: number; issues: RowIssue[] }[];
  counts: { total: number; created: number; failed: number };
}

export function blankValues(): Record<ImportField, string> {
  return Object.fromEntries(IMPORT_FIELDS.map((f) => [f, ""])) as Record<ImportField, string>;
}

/* --------------------------------------------------------------- the checks --- */

const CONDITIONS = new Set(["new", "used"]);

/** How two rows are judged to be the same item: the brand, and the name loosely. */
function itemKey(row: ImportRow): string {
  return `${row.brandId}|${row.values.name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

/** Everything the browser can decide about one row on its own. */
function ownIssues(row: ImportRow): RowIssue[] {
  const { values } = row;
  const issues: RowIssue[] = [];
  const add = (field: ImportField, message: string) => issues.push({ field, message });

  if (values.name.trim().length < 2) add("name", "An item needs a name");
  // A cell that names something the pickers do not know is the fault the
  // preview is for: pick one, or leave it blank to file under none.
  if (values.brand.trim() && !row.brandId) add("brand", "Pick a brand, or leave it blank");
  if (values.category.trim() && !row.categoryId) {
    add("category", "Pick a category, or leave it blank");
  }

  const quantity = values.quantityInStock.trim().replace(/,/g, "");
  if (quantity === "") add("quantityInStock", "How many units are on the shelf");
  else if (!/^\d+$/.test(quantity)) add("quantityInStock", "A whole number of units, like 4");

  const cost = values.costPrice.trim() === "" ? null : parseCedis(values.costPrice);
  const price = values.sellingPrice.trim() === "" ? null : parseCedis(values.sellingPrice);
  if (values.costPrice.trim() === "") add("costPrice", "What Yadah paid, in cedis");
  else if (cost == null || cost < 1) add("costPrice", "An amount in cedis, like 2800");
  if (values.sellingPrice.trim() === "") add("sellingPrice", "What the customer pays, in cedis");
  else if (price == null || price < 1) add("sellingPrice", "An amount in cedis, like 3500");
  else if (cost != null && price < cost) {
    add("sellingPrice", "Below the cost price — enter the same figure twice to sell at cost");
  }

  const condition = values.condition.trim().toLowerCase();
  if (condition && !CONDITIONS.has(condition)) add("condition", "New or used");

  return issues;
}

/**
 * Re-check the whole sheet. Server issues are kept only where the cell they
 * were about has not been touched — once someone renames a flagged item, the
 * API's "already on the shelf" no longer describes what is in the box.
 */
export function checkRows(rows: ImportRow[]): ImportRow[] {
  const first = new Map<string, number>();

  return rows.map((row) => {
    const issues = ownIssues(row);

    if (row.values.name.trim()) {
      const key = itemKey(row);
      const earlier = first.get(key);
      if (earlier !== undefined) {
        issues.push({ field: "name", message: `Same item as row ${earlier}` });
      } else {
        first.set(key, row.row);
      }
    }

    const kept = row.issues.filter(
      (i) => i.fromServer && !issues.some((own) => own.field === i.field),
    );
    return { ...row, issues: [...issues, ...kept] };
  });
}
