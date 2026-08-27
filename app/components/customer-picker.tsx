import { CheckIcon, Loader2Icon, SearchIcon, UserIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { initialsOf } from "~/lib/auth";
import { cn } from "~/lib/utils";

export interface PickedCustomer {
  id: string;
  fullName: string;
  phone: string;
}

/**
 * Find a customer by name or phone, then hold onto the one chosen.
 *
 * Every module that opens an account starts here, so it is a component rather
 * than something each screen rebuilds. It searches through `/customers/search`,
 * which is server-side and session-gated — the browser never holds a token — and
 * writes the chosen id into a hidden field so the surrounding form submits it.
 */
export function CustomerPicker({
  name = "customerId",
  value,
  onChange,
  autoFocus,
}: {
  name?: string;
  value: PickedCustomer | null;
  onChange: (next: PickedCustomer | null) => void;
  autoFocus?: boolean;
}) {
  const fetcher = useFetcher<{ items: PickedCustomer[] }>();
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const run = (q: string) => {
    if (q.trim().length < 2) return;
    fetcher.load(`/customers/search?q=${encodeURIComponent(q.trim())}`);
  };

  const onType = (next: string) => {
    setQuery(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(next), 250);
  };

  // Chosen: the search collapses to the one row, so the form reads as settled
  // rather than as a box still waiting for an answer.
  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
        <input type="hidden" name={name} value={value.id} />
        <Avatar name={value.fullName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{value.fullName}</p>
          <p className="tabular truncate text-xs text-muted-foreground">{value.phone}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            onChange(null);
            setQuery("");
            queueMicrotask(() => inputRef.current?.focus());
          }}
          aria-label={`Choose someone other than ${value.fullName}`}
        >
          <XIcon />
        </Button>
      </div>
    );
  }

  const hits = fetcher.data?.items ?? [];
  const searching = fetcher.state !== "idle";
  const short = query.trim().length < 2;

  return (
    <div className="space-y-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            // Enter must not submit the form while the box is still a search.
            if (e.key === "Enter") {
              e.preventDefault();
              clearTimeout(timer.current);
              run(query);
            }
          }}
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder="Search name or phone"
          aria-label="Search for a customer"
          className="pr-9 pl-9"
        />
        {searching && (
          <Loader2Icon className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {short ? (
        <p className="text-xs text-muted-foreground">Two characters or more.</p>
      ) : hits.length === 0 && !searching ? (
        <p className="text-xs text-muted-foreground">
          No active customer matched. Deactivated records are not shown.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => onChange(hit)}
                className={cn(
                  "group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                  "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                )}
              >
                <Avatar name={hit.fullName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{hit.fullName}</p>
                  <p className="tabular truncate text-xs text-muted-foreground">
                    {hit.phone}
                  </p>
                </div>
                <CheckIcon className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
    >
      {name ? initialsOf(name) : <UserIcon className="size-4" />}
    </span>
  );
}
