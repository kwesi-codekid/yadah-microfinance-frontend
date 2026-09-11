import { data, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import {
  createLabel,
  deleteLabel,
  getLabel,
  listItems,
  listLabels,
  updateLabel,
} from "~/api/hire-purchase";
import { isOffice } from "~/lib/auth";
import { isSellable, type LabelKind } from "~/lib/hire-purchase";
import {
  LABEL_COPY,
  LABEL_PAGE_SIZE as PAGE_SIZE,
  capitalise,
  type LabelActionResult as ActionResult,
  type LabelDetailData,
  type LabelFormData,
  type LabelListData,
} from "~/lib/labels";
import { requireCounter, requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";

/**
 * The loaders and actions behind the brand and category pages. Each route
 * module says which kind it is and hands its args here; the screens
 * themselves are in `~/components/label-book`.
 */

export async function loadLabelList(kind: LabelKind, { request }: LoaderFunctionArgs) {
  const viewer = await requireCounter(request);
  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: list, headers } = await withAuth(request, (token) =>
    listLabels(token, kind, { page, limit: PAGE_SIZE, search: search || undefined }),
  );

  return data<LabelListData>(
    { kind, canDelete: isOffice(viewer), search, page, total: list.total, rows: list.items },
    { headers },
  );
}

export async function actOnLabelList(kind: LabelKind, { request }: ActionFunctionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  if (!id) return data<ActionResult>({ ok: false, message: "Nothing chosen." }, { status: 400 });

  try {
    const { headers } = await withAuth(request, (token) => deleteLabel(token, kind, id));
    return data<ActionResult>(
      { ok: true, message: `${capitalise(LABEL_COPY[kind].one)} deleted.` },
      { headers },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data<ActionResult>({ ok: false, message: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function loadLabelDetail(kind: LabelKind, { request, params }: LoaderFunctionArgs) {
  await requireCounter(request);
  const id = String(params.id);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const [{ label }, list] = await Promise.all([
        getLabel(token, kind, id),
        listItems(token, {
          ...(kind === "brand" ? { brandId: id } : { categoryId: id }),
          limit: 100,
        }),
      ]);
      return { label, items: list.items };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data<LabelDetailData>(
    {
      kind,
      label: result.label,
      items: result.items.map((item) => ({
        id: item.id,
        name: item.name,
        // The other label, so a brand's page still says what kind each thing is.
        detail: [
          kind === "brand" ? item.category?.name : item.brand?.name,
          item.condition === "used" ? "Used" : "",
          item.description,
        ]
          .filter(Boolean)
          .join(" · "),
        quantityInStock: item.quantityInStock,
        sellingPrice: item.sellingPrice,
        status: item.status,
        sellable: isSellable(item),
      })),
    },
    { headers },
  );
}

export async function loadLabelForm(
  kind: LabelKind,
  mode: "new" | "edit",
  { request, params }: LoaderFunctionArgs,
) {
  await requireCounter(request);
  if (mode === "new") return data<LabelFormData>({ kind, label: null });

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      return await getLabel(token, kind, String(params.id));
    } catch (error) {
      throwAsRouteError(error);
    }
  });
  return data<LabelFormData>({ kind, label: result.label }, { headers });
}

export async function actOnLabelForm(
  kind: LabelKind,
  mode: "new" | "edit",
  { request, params }: ActionFunctionArgs,
) {
  await requireCounter(request);
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const copy = LABEL_COPY[kind];

  if (!name) return data({ error: `Give the ${copy.one} a name.` }, { status: 400 });

  try {
    if (mode === "new") {
      const { data: result, headers } = await withAuth(request, (token) =>
        createLabel(token, kind, { name, ...(description ? { description } : {}) }),
      );
      await redirectWithToast(
        `${copy.path}/${result.label.id}`,
        { tone: "success", message: `${name} added.` },
        headers,
      );
    }
    const id = String(params.id);
    const { headers } = await withAuth(request, (token) =>
      updateLabel(token, kind, id, { name, description: description || null }),
    );
    await redirectWithToast(
      `${copy.path}/${id}`,
      { tone: "success", message: `${name} saved.` },
      headers,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
