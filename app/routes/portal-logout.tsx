import { redirect } from "react-router";

import { PORTAL_LOGIN_PATH } from "~/lib/paths";
import { portalLogout } from "~/lib/portal-session.server";
import type { Route } from "./+types/portal-logout";

/** Signing out is a POST — a GET that ends a session is a link that can be planted. */
export async function action({ request }: Route.ActionArgs) {
  return portalLogout(request);
}

export function loader() {
  return redirect(PORTAL_LOGIN_PATH);
}
