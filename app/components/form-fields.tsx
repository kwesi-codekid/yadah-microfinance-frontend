import { Label, ListBox, Select, Tooltip } from "@heroui/react";
import { Link } from "react-router";
import { TextInput } from "~/components/inputs";

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
        {/* ps/pe, not px: px would clobber the pe-7 HeroUI reserves for the chevron. */}
        <Select.Trigger className="min-h-10 w-full rounded-md border-2 border-border bg-white ps-3 pe-7 py-2 text-sm text-foreground shadow-none dark:bg-zinc-950">
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

const NO_FILTER = "__any";

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
    <>
      <input type="hidden" name={name} value={value} />
      <Select
        aria-label={label}
        selectedKey={value || NO_FILTER}
        onSelectionChange={(key) =>
          onChange(key === NO_FILTER ? "" : String(key))
        }
        className="text-left"
      >
        <Select.Trigger
          className={`${FIELD} flex items-center justify-between gap-2 border-2 border-border bg-field ps-3 pe-7 py-1 text-foreground`}
        >
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover className="rounded-md border-2 border-border p-1">
          <ListBox>
            {options.map((option) => (
              <ListBox.Item
                key={option.value || NO_FILTER}
                id={option.value || NO_FILTER}
                className="cursor-pointer rounded-md px-3 py-1.5 text-sm"
              >
                {option.label}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </>
  );
}

const ICON_ACTION =
  "flex size-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground";

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
