import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { LoaderCircle, Search, UserRound, X } from "lucide-react";
import { FIELD } from "~/components/form-fields";
import { TextInput } from "~/components/inputs";
import { MIN_QUERY, type CustomerMatch } from "~/lib/customer-search";

export type { CustomerMatch };

/**
 * Picks the customer an account is being opened for, without leaving the page.
 * Holds the chosen id in a hidden input so it posts with the rest of the form.
 */
export function CustomerPicker({
  name = "customerId",
  selected,
  onSelect,
  autoFocus,
}: {
  name?: string;
  selected: CustomerMatch | null;
  onSelect: (customer: CustomerMatch | null) => void;
  autoFocus?: boolean;
}) {
  const fetcher = useFetcher<{ items: CustomerMatch[] }>();
  const [query, setQuery] = useState("");

  const trimmed = query.trim();
  const searchable = trimmed.length >= MIN_QUERY;

  // One request per pause in typing, matching the account-number search.
  useEffect(() => {
    if (selected || !searchable) return;
    const timer = setTimeout(() => {
      fetcher.load(`/customers/search?q=${encodeURIComponent(trimmed)}`);
    }, 300);
    return () => clearTimeout(timer);
    // `fetcher` is stable enough to leave out; including it re-runs the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, searchable, selected]);

  if (selected) {
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Customer</p>
        <input type="hidden" name={name} value={selected.id} />
        <div className="flex items-center gap-3 rounded-md border-2 border-success/40 bg-success/10 px-3 py-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success/20 text-success">
            <UserRound size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">
              {selected.fullName}
            </span>
            <span className="block truncate text-xs text-muted">
              {selected.phone}
            </span>
          </span>
          <button
            type="button"
            aria-label="Choose a different customer"
            onClick={() => {
              onSelect(null);
              setQuery("");
            }}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-tertiary hover:text-foreground"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    );
  }

  const searching = fetcher.state === "loading";
  const items = fetcher.data?.items ?? [];
  // Results for an older query still show while the next request is in flight.
  const settled = searchable && !searching && fetcher.data !== undefined;

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <TextInput
          label="Customer"
          value={query}
          onChange={setQuery}
          autoFocus={autoFocus}
          inputProps={{
            placeholder: "Name or phone number",
            autoComplete: "off",
            className: `${FIELD} pl-8`,
          }}
        />
        {searching ? (
          <LoaderCircle
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute bottom-2.5 left-2.5 animate-spin text-success"
          />
        ) : (
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute bottom-2.5 left-2.5 text-success"
          />
        )}
      </div>

      {!searchable ? (
        <p className="text-xs text-muted">
          Type at least {MIN_QUERY} characters of a name or phone number.
        </p>
      ) : items.length === 0 ? (
        // Nothing to show until the first response lands.
        settled && (
          <p className="text-xs text-muted">
            No active customer matches “{trimmed}”.
          </p>
        )
      ) : (
        <ul className="max-h-60 overflow-y-auto rounded-md border-2 border-border">
          {items.map((customer) => (
            <li key={customer.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => onSelect(customer)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-tertiary"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {customer.fullName}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {customer.phone}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
