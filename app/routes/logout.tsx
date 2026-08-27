import { redirect } from "react-router";

import { LOGIN_PATH } from "~/lib/paths";
import { logout } from "~/lib/session.server";
import type { Route } from "./+types/logout";

/** POST only: a prefetch, a crawler or a stray link must not end a session. */
export async function action({ request }: Route.ActionArgs) {
  return logout(request);
}

export async function loader() {
  return redirect(LOGIN_PATH);
}
