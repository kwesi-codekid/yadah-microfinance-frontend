import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { logout } from "~/lib/session.server";

/** POST /logout — revoke the refresh session server-side, then clear the cookie. */
export async function action({ request }: Route.ActionArgs) {
  return logout(request);
}

/** GET /logout isn't a real page; send them to the login screen. */
export function loader() {
  return redirect("/login");
}
