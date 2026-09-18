import { Link } from "react-router";

import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { ItemLabel } from "~/lib/hire-purchase";

/**
 * The two labels an item is filed under besides its name: who makes it and
 * what kind of thing it is. Picked from the managed lists rather than typed,
 * so "Nasco" is one brand however many people stock it. Each select posts
 * the label's id; "None" posts nothing.
 */

const NONE = "__none__";

export function ItemLabels({
  brands,
  categories,
  defaults,
}: {
  brands: ItemLabel[];
  categories: ItemLabel[];
  defaults?: { brandId: string; categoryId: string };
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <LabelSelect
        name="brandId"
        label="Brand"
        options={brands}
        defaultValue={defaults?.brandId ?? ""}
        manageTo="/inventory/brands"
      />
      <LabelSelect
        name="categoryId"
        label="Category"
        options={categories}
        defaultValue={defaults?.categoryId ?? ""}
        manageTo="/inventory/categories"
      />
    </div>
  );
}

function LabelSelect({
  name,
  label,
  options,
  defaultValue,
  manageTo,
}: {
  name: string;
  label: string;
  options: ItemLabel[];
  defaultValue: string;
  manageTo: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label
          htmlFor={name}
          className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >
          {label}
        </Label>
        {/* The list is managed elsewhere; a name that is missing is added
            there, not typed here. */}
        <Link
          to={manageTo}
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          Manage
        </Link>
      </div>
      {/* Radix's Select cannot carry an empty value, so "None" is a sentinel
          the form parser turns back into nothing. */}
      <Select name={name} defaultValue={defaultValue || NONE}>
        <SelectTrigger id={name} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>None</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The id a label select posted, or undefined for "None". */
export function labelIdFrom(value: FormDataEntryValue | null): string | undefined {
  const v = String(value ?? "").trim();
  return v && v !== NONE ? v : undefined;
}
