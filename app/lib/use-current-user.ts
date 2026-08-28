import { useRouteLoaderData } from "react-router";

import type { AuthUser } from "~/lib/auth";

/**
 * Who is signed in, read off the app layout's loader from any page under it.
 * Null outside the layout (the portal, the printable sheets) or before the
 * layout has loaded. For gating a button, not a page — pages gate in their
 * own loader with `requireOffice` / `requireAdmin`.
 */
export function useCurrentUser(): AuthUser | null {
  const layout = useRouteLoaderData("routes/app-layout") as { user?: AuthUser } | undefined;
  return layout?.user ?? null;
}
