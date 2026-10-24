import { Command as CommandPrimitive } from "cmdk";
import { CornerDownLeftIcon, SearchIcon, UserIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate } from "react-router";

import { visibleNavItems } from "~/components/nav-items";
import { GlassScrollArea } from "~/components/ui/glass-scroll-area";
import type { AuthUser } from "~/lib/auth";
import { cn } from "~/lib/utils";
import type { CustomerHit } from "~/routes/customer-search";

/**
 * The header's one search: a glass pill that opens a command palette. Pages
 * the reader may open are listed straight away and narrowed as they type;
 * customers are looked up through `/customers/search` once two letters are in.
 *
 * Ctrl+K (⌘K on a Mac) opens it from anywhere.
 */
export function GlobalSearch({ user }: { user: AuthUser }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((was) => !was);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        aria-keyshortcuts="Control+K Meta+K"
        className="flex w-40 items-center gap-2 rounded-full border border-white/60 bg-white/45 py-1.5 pr-1.5 pl-3.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md backdrop-saturate-150 outline-none transition-colors hover:bg-white/65 focus-visible:ring-2 focus-visible:ring-ring/30 sm:w-60 dark:border-white/10 dark:bg-white/5 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:hover:bg-white/10"
      >
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-xs text-muted-foreground">Search</span>
        <span className="hidden shrink-0 items-center gap-1 sm:flex" aria-hidden>
          <Key>Ctrl</Key>
          <Key>K</Key>
        </span>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/10 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed top-[12vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 overflow-hidden rounded-xl border border-white/70 bg-white/75 text-foreground shadow-[0_24px_60px_-12px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-2xl backdrop-saturate-150 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 dark:border-white/10 dark:bg-neutral-900/75 dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.06)]"
        >
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search pages and customers
          </DialogPrimitive.Description>
          {/* Mounted only while open, so every opening starts on a clean box. */}
          {open && <Palette user={user} close={() => setOpen(false)} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Palette({ user, close }: { user: AuthUser; close: () => void }) {
  const navigate = useNavigate();
  const fetcher = useFetcher<{ items: CustomerHit[] }>();
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const q = query.trim();
  const lookup = q.length >= 2;

  const onType = (next: string) => {
    setQuery(next);
    clearTimeout(timer.current);
    const term = next.trim();
    if (term.length >= 2) {
      timer.current = setTimeout(
        () => fetcher.load(`/customers/search?q=${encodeURIComponent(term)}`),
        200,
      );
    }
  };

  const go = (to: string) => {
    close();
    navigate(to);
  };

  const needle = q.toLowerCase();
  const pages = visibleNavItems(user).filter(
    (item) =>
      !needle ||
      item.label.toLowerCase().includes(needle) ||
      item.blurb.toLowerCase().includes(needle),
  );
  const customers = lookup ? (fetcher.data?.items ?? []) : [];
  const searching = lookup && fetcher.state !== "idle";

  return (
    // Filtering is done here, not by cmdk: customer hits come back already
    // matched by the API, and cmdk would hide a hit found by phone number.
    <CommandPrimitive shouldFilter={false} loop className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-black/10 px-5 dark:border-white/10">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <CommandPrimitive.Input
          autoFocus
          value={query}
          onValueChange={onType}
          placeholder="Search customers and pages..."
          className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
      </div>

      <GlassScrollArea className="max-h-[min(60vh,420px)] *:data-[slot=glass-scroll-area-viewport]:max-h-[inherit]">
      <CommandPrimitive.List className="scroll-py-2 p-2">
        <CommandPrimitive.Empty className="py-10 text-center text-sm text-muted-foreground">
          {searching ? "Searching…" : `Nothing matches “${q}”.`}
        </CommandPrimitive.Empty>

        {lookup && (customers.length > 0 || !searching) && (
          <CommandPrimitive.Group heading="Customers" className={GROUP}>
            {customers.map((c) => (
              <CommandPrimitive.Item
                key={c.id}
                value={`customer-${c.id}`}
                onSelect={() => go(`/customers/${c.id}`)}
                className={ITEM}
              >
                <UserIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{c.fullName}</span>
                <span className="ml-auto shrink-0 text-xs tracking-wide text-muted-foreground">
                  {c.phone}
                </span>
              </CommandPrimitive.Item>
            ))}
            <CommandPrimitive.Item
              value="customer-all"
              onSelect={() => go(`/customers?search=${encodeURIComponent(q)}`)}
              className={ITEM}
            >
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                See all customers matching “{q}”
              </span>
            </CommandPrimitive.Item>
          </CommandPrimitive.Group>
        )}

        {pages.length > 0 && (
          <CommandPrimitive.Group heading="Pages" className={GROUP}>
            {pages.map((item) => (
              <CommandPrimitive.Item
                key={item.to}
                value={`page-${item.to}`}
                onSelect={() => go(item.to)}
                className={ITEM}
              >
                <item.icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.label}</span>
                <span className="ml-auto hidden shrink-0 text-xs tracking-wide text-muted-foreground sm:block">
                  {item.blurb.replace(/\.$/, "")}
                </span>
              </CommandPrimitive.Item>
            ))}
          </CommandPrimitive.Group>
        )}
      </CommandPrimitive.List>
      </GlassScrollArea>

      <div className="flex items-center gap-4 border-t border-black/10 px-5 py-2.5 text-[11px] text-muted-foreground dark:border-white/10">
        <span className="flex items-center gap-1.5">
          <Key>↑</Key>
          <Key>↓</Key>
          to move
        </span>
        <span className="flex items-center gap-1.5">
          <Key>
            <CornerDownLeftIcon className="size-2.5" />
          </Key>
          to open
        </span>
        <span className="flex items-center gap-1.5">
          <Key>esc</Key>
          to close
        </span>
      </div>
    </CommandPrimitive>
  );
}

const GROUP =
  "mb-1 **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground";

const ITEM =
  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-none select-none data-[selected=true]:bg-black/[0.06] dark:data-[selected=true]:bg-white/10";

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-black/10 bg-white/80 px-1.5 font-sans text-[10px] font-medium text-foreground shadow-[0_1px_0_rgba(0,0,0,0.06)] dark:border-white/15 dark:bg-white/10",
      )}
    >
      {children}
    </kbd>
  );
}
