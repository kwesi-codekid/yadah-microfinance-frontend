import { LabelForm } from "~/components/label-book";
import { actOnLabelForm, loadLabelForm } from "~/lib/label-book.server";
import type { Route } from "./+types/inventory-category-edit";

export const loader = (args: Route.LoaderArgs) => loadLabelForm("category", "edit", args);
export const action = (args: Route.ActionArgs) => actOnLabelForm("category", "edit", args);

export default function Page({ loaderData }: Route.ComponentProps) {
  return <LabelForm data={loaderData} />;
}
