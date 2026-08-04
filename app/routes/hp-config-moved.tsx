import { redirect } from "react-router";

/** `/hire-purchase/config` moved under Settings. Kept so old links still land. */
export function loader() {
  throw redirect("/settings/hire-purchase", { status: 301 });
}
