import { LabelList } from "~/components/label-book";
import { actOnLabelList, loadLabelList } from "~/lib/label-book.server";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
import type { Route } from "./+types/inventory-categories";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Categories · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = { title: "Categories" };

export const loader = (args: Route.LoaderArgs) => loadLabelList("category", args);
export const action = (args: Route.ActionArgs) => actOnLabelList("category", args);

/** Opening the add drawer does not re-read the list underneath it. */
export const shouldRevalidate = drawerParentShouldRevalidate;

export default function Page({ loaderData }: Route.ComponentProps) {
  return <LabelList data={loaderData} />;
}
