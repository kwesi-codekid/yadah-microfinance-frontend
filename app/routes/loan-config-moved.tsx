import { redirect } from "react-router";

/** `/loans/config` moved under Settings. Kept so old links still land. */
export function loader() {
  throw redirect("/settings/loans", { status: 301 });
}
