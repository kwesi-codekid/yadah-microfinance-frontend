import { Label, ListBox, Select, Tooltip } from "@heroui/react";
import { ChevronDown } from "lucide-react";
import { Link } from "react-router";
import { TextInput } from "~/components/inputs";

/**
 * The field vocabulary shared by the management pages (staff, customers).
 *
 * These started out local to `staff.tsx`; they moved here when `customers.tsx`
 * needed the same set, so the two pages can't drift into looking like two
 * different apps. Anything genuinely page-specific stays in the route.
 */

// Compact, flat fields: 32px tall, soft corners, no shadow of their own.
// Shared by the filter bars and the drawer forms so they read as one set.
export const FIELD = "min-h-8 rounded-md text-sm shadow-none focus:ring-0";

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="text-sm text-red-600 dark:text-red-400" role="alert">
      {message}
    </p>
  );
}

export function Field({
  name,
  label,
  defaultValue,
  type,
  error,
  isRequired = true,
  inputProps,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
  error?: string;
  /** Most fields are required; the optional ones say so in their label. */
  isRequired?: boolean;
  inputProps?: React.ComponentProps<typeof TextInput>["inputProps"];
}) {
  return (
    <div className="space-y-1.5">
      <TextInput
        name={name}
        label={label}
        type={type}
        defaultValue={defaultValue}
        isRequired={isRequired}
        inputProps={{
          ...inputProps,
          className: [FIELD, inputProps?.className].filter(Boolean).join(" "),
        }}
      />
      <FieldError message={error} />
    </div>
  );
}

/**
 * Themed dropdown on HeroUI's `Select`, so the options render as a styled
 * popover instead of the OS list a native `<select>` opens. It still posts
 * with the form — react-aria mirrors the selected key into a hidden input
 * named `name`.
 *
 * The trigger's padding and radius mirror HeroUI's `.input` (px-3 py-2, 20px
 * line, 2px border = 40px) so it matches the text fields stacked above it.
 */
export function SelectField({
  name,
  label,
  defaultValue,
  placeholder = "Select…",
  options,
  error,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  options: { value: string; label: string }[];
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Select
        name={name}
        // "" means nothing chosen yet; react-aria wants that as undefined.
        defaultSelectedKey={defaultValue || undefined}
        placeholder={placeholder}
        className="flex flex-col gap-1.5 text-left"
      >
        <Label className="font-medium text-foreground">{label}</Label>
        <Select.Trigger className="min-h-10 w-full rounded-md border-2 border-border bg-white px-3 py-2 text-sm text-foreground shadow-none dark:bg-zinc-950">
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover className="rounded-md border-2 border-border p-1">
          <ListBox>
            {options.map((option) => (
              <ListBox.Item
                key={option.value}
                id={option.value}
                className="rounded-md px-3 py-2 text-sm"
              >
                {option.label}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      <FieldError message={error} />
    </div>
  );
}

/**
 * Compact filter dropdown for the bar above a table. A native `<select>`
 * rather than HeroUI's `Select`: it keeps the `name` in the form for the no-JS
 * path, and matches the 32px height of the search field beside it (HeroUI's
 * trigger is built for the 40px form fields in the drawer).
 */
export function FilterSelect({
  name,
  label,
  value,
  onChange,
  options,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        name={name}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // `pr-8` clears the chevron; the arrow the browser draws is replaced so
        // it matches the icon set the rest of the page uses.
        className={`${FIELD} appearance-none border-2 border-border bg-field py-1 pl-3 pr-8 text-foreground outline-none`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-2.5 my-auto text-muted"
      />
    </div>
  );
}

const ICON_ACTION =
  "flex size-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground";

/**
 * The same treatment as `IconAction`, for a row action that navigates.
 *
 * The label rides in a HeroUI `Tooltip` rather than the native `title`: the
 * browser's version waits a second, can't be styled, and never appears on
 * keyboard focus. `render` hands the trigger's props to the `Link` itself, so
 * the hover/focus target *is* the anchor — the default wrapper `<div
 * role="button">` around a link would be a second tab stop and the wrong role.
 */
export function IconLink({
  label,
  to,
  children,
}: {
  label: string;
  to: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <Tooltip.Trigger<"a">
        className={ICON_ACTION}
        render={(props) => (
          <Link {...props} role={undefined} to={to} aria-label={label} />
        )}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}

/** Borderless icon button for a table row's action cluster. */
export function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <Tooltip.Trigger<"button">
        className={ICON_ACTION}
        render={(props) => (
          <button
            {...props}
            type="button"
            onClick={onClick}
            aria-label={label}
          />
        )}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}
