import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  type ShouldRevalidateFunction,
} from "react-router";

import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { cn } from "~/lib/utils";

/**
 * The shell a route opens in when it is an errand rather than a destination:
 * a right-hand drawer over the listing that launched it.
 *
 * Adding, editing and reading a record are all short errands, and sending
 * someone to a full page for one costs them the row they were looking at and
 * the filters they set to find it. The drawer keeps the list underneath, so
 * closing it puts them back exactly where they were.
 *
 * These stay real routes rather than local state: the URL still addresses one
 * record, the loader still gates it server-side, and a link to it still works
 * when pasted into a browser cold.
 */

/**
 * What a page that hosts drawers should export as its `shouldRevalidate`.
 *
 * Single Fetch asks every route still matched whether to run its loader and
 * assumes the answer is yes, so opening a drawer re-read the page underneath
 * it — on the savings account that is five API calls — and held the panel shut
 * until they came back. What people saw was the page reloading, and only then
 * the drawer. A drawer is not a reason to re-read the page it opens over: it
 * either carries its own loader or draws from the page's data, and either way
 * nothing behind it has changed.
 *
 * Only the opening move is refused here, and only when the query string is
 * untouched. Closing is handled at the call site instead, in `RouteSheet` —
 * a cancel and an action that just went through both come back to this exact
 * URL, and only the code doing the closing can tell the two apart.
 */
export const drawerParentShouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}) => {
  // A submission changed something. Read it back.
  if (formMethod && formMethod !== "GET") return defaultShouldRevalidate;
  // Filters, paging, a pane being switched: all of it rides in the query
  // string, and all of it changes what the page has to show.
  if (currentUrl.search !== nextUrl.search) return defaultShouldRevalidate;
  // `/staff` to `/staff/:id`, `/savings/:id` to `/savings/:id/deposit`: a
  // drawer opening over a page that is otherwise exactly as it was.
  if (nextUrl.pathname.startsWith(`${currentUrl.pathname}/`)) return false;
  return defaultShouldRevalidate;
};

/**
 * How a drawer closes itself, and where closing points.
 *
 * `close` takes an optional target for the drawers that do not go back where
 * they came from — editing a staff member returns to reading them, not to the
 * listing. `href` is the same journey as a real URL, for the anchor underneath.
 */
const SheetCloseContext = createContext<{
  close: (to?: string) => void;
  href: (to?: string) => string;
}>({
  close: () => {},
  href: () => "",
});

/**
 * Close the drawer this is called from. The panel starts sliding out at once
 * and the navigation back to the list runs behind it.
 */
export function useCloseSheet() {
  return useContext(SheetCloseContext).close;
}

export function RouteSheet({
  title,
  description,
  backTo,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Where closing goes. The current query string rides along. */
  backTo: string;
  /** Owns its own padding, scrolling and footer — see the routes for the shape. */
  children: ReactNode;
  className?: string;
}) {
  const navigate = useNavigate();
  const { search } = useLocation();

  // The drawer's own state, deliberately not the route's. Bound straight to
  // the route, `open` could only ever become false by this component being
  // unmounted — so the panel sat there under the pointer for the whole
  // navigation, and then vanished without its exit animation. Closing now
  // flips this first: Radix slides the drawer out while the loader behind it
  // runs, which is the part that can take a moment.
  const [open, setOpen] = useState(true);

  // Wherever a drawer closes to, the filters that were on the list ride along.
  const href = useCallback(
    (to?: string) => `${to ?? backTo}${search}`,
    [backTo, search],
  );

  const close = useCallback((to?: string) => {
    setOpen(false);
    // Closing means "back to the list", with whatever filters were on it.
    //
    // `defaultShouldRevalidate: false` is what keeps the list from reloading
    // underneath. Single Fetch asks every route still matched whether to run
    // its loader and assumes yes, so the page behind the drawer re-read itself
    // — every API call it makes — each time someone pressed Cancel. Nothing
    // was submitted, so nothing behind it can have changed. Saying so at the
    // call site is what tells the two cases apart: an action that succeeded
    // redirects here on its own, without this flag, and still revalidates.
    navigate(
      { pathname: to ?? backTo, search },
      { preventScrollReset: true, defaultShouldRevalidate: false },
    );
  }, [backTo, navigate, search]);

  return (
    <SheetCloseContext.Provider value={{ close, href }}>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <SheetContent
          side="right"
          className={cn("w-full gap-0 p-0 sm:max-w-xl", className)}
        >
          <SheetHeader className="shrink-0 gap-1 border-b border-border px-5 py-4 pr-14">
            <SheetTitle className="font-heading truncate text-lg font-bold tracking-tight">
              {title}
            </SheetTitle>
            {description ? (
              <SheetDescription asChild>
                <div className="truncate">{description}</div>
              </SheetDescription>
            ) : (
              // Radix warns when a dialog has no description; this satisfies it
              // without putting an empty line under every title.
              <SheetDescription className="sr-only">{title}</SheetDescription>
            )}
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    </SheetCloseContext.Provider>
  );
}

/**
 * The cancel button in a drawer's action row. It closes the way the X and the
 * Escape key do — panel first, navigation behind — while keeping a real href,
 * so the target is still visible on hover and open-in-new-tab still works.
 */
export function SheetCancel({
  children = "Cancel",
  to,
  className,
}: {
  children?: ReactNode;
  /** Where cancelling lands, when that is not where the drawer opened from. */
  to?: string;
  className?: string;
}) {
  const { close, href } = useContext(SheetCloseContext);

  return (
    <Button asChild variant="ghost" className={className}>
      <Link
        to={href(to)}
        onClick={(event) => {
          // Router's own handler stands down once this is prevented, leaving
          // the close to drive the navigation.
          event.preventDefault();
          close(to);
        }}
      >
        {children}
      </Link>
    </Button>
  );
}

/** The scrolling middle of a drawer. */
export function SheetBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-5", className)}>
      {children}
    </div>
  );
}

/** The row of actions pinned under it. */
export function SheetActions({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
