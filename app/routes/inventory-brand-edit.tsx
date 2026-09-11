import { LabelForm } from "~/components/label-book";
import { actOnLabelForm, loadLabelForm } from "~/lib/label-book.server";
import type { Route } from "./+types/inventory-brand-edit";

export const loader = (args: Route.LoaderArgs) => loadLabelForm("brand", "edit", args);
export const action = (args: Route.ActionArgs) => actOnLabelForm("brand", "edit", args);

export default function Page({ loaderData }: Route.ComponentProps) {
  return <LabelForm data={loaderData} />;
}
