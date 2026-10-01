import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useState } from "react";

import { Input } from "~/components/ui/input";
import { planLabel, type SusuPlan } from "~/lib/susu";
import { cn } from "~/lib/utils";

/**
 * Which plan a movement of money is for. The field is the search: type "20"
 * and the list under it narrows to the twenty. Drawn without a popup library
 * so it behaves inside a drawer — the list is part of the form, not a layer
 * over it — and each option is the amount and nothing else.
 *
 * Shared by the deposit and withdraw drawers, so the two read as one control.
 */
export function PlanPicker({
  id,
  plans,
  value,
  onChange,
  disabled,
}: {
  id: string;
  plans: SusuPlan[];
  value: string | null;
  onChange: (planId: string) => void;
  disabled: boolean;
}) {
  const selected = plans.find((p) => p.id === value) ?? null;
  const [open, setOpen] = useState(false);
  // What has been typed since the list opened; null means nothing yet, and
  // the field shows the chosen plan instead.
  const [query, setQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const listId = `${id}-options`;

  const shown = query
    ? plans.filter((p) => planLabel(p).toLowerCase().includes(query.trim().toLowerCase()))
    : plans;
  const active = shown[Math.min(highlighted, Math.max(0, shown.length - 1))];

  const close = () => {
    setOpen(false);
    setQuery(null);
  };
  const choose = (plan: SusuPlan) => {
    onChange(plan.id);
    close();
  };
  const openList = () => {
    setOpen(true);
    setHighlighted(Math.max(0, plans.findIndex((p) => p.id === value)));
  };

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active ? `${listId}-${active.id}` : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={plans.length ? "Type an amount…" : "No plan running"}
        value={query ?? (selected ? planLabel(selected) : "")}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlighted(0);
          if (!open) setOpen(true);
        }}
        onFocus={openList}
        onClick={() => !open && openList()}
        onBlur={close}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) openList();
            else setHighlighted((h) => Math.min(h + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            if (open && active) {
              e.preventDefault();
              choose(active);
            }
          } else if (e.key === "Escape") {
            if (open) {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }
        }}
        className="tabular pr-9"
      />
      <ChevronsUpDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Plans"
          className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {shown.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">No plan matches.</li>
          ) : (
            shown.map((p) => (
              <li
                key={p.id}
                id={`${listId}-${p.id}`}
                role="option"
                aria-selected={p.id === value}
                // Selecting is a mousedown, not a click: the click would land
                // after the field's blur had already closed the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
                onMouseEnter={() => setHighlighted(shown.indexOf(p))}
                className={cn(
                  "tabular flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none",
                  active?.id === p.id && "bg-accent text-accent-foreground",
                )}
              >
                {planLabel(p)}
                <CheckIcon className={cn("ml-auto size-4", p.id === value ? "opacity-100" : "opacity-0")} />
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
