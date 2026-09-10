import { LabelForm } from "~/components/label-book";
import { actOnLabelForm, loadLabelForm } from "~/lib/label-book.server";
import type { Route } from "./+types/inventory-brand-new";

export const loader = (args: Route.LoaderArgs) => loadLabelForm("brand", "new", args);
export const action = (args: Route.ActionArgs) => actOnLabelForm("brand", "new", args);

export default function Page({ loaderData }: Route.ComponentProps) {
  return <LabelForm data={loaderData} />;
}
