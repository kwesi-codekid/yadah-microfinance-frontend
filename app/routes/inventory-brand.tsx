import { LabelDetail } from "~/components/label-book";
import { loadLabelDetail } from "~/lib/label-book.server";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
import type { Route } from "./+types/inventory-brand";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.label.name ?? "Brands"} · Yadah Dynamic Enterprise` }];
}

export const handle = { title: "Brands" };

export const loader = (args: Route.LoaderArgs) => loadLabelDetail("brand", args);

/** Opening the rename drawer does not re-read the page underneath it. */
export const shouldRevalidate = drawerParentShouldRevalidate;

export default function Page({ loaderData }: Route.ComponentProps) {
  return <LabelDetail data={loaderData} />;
}
