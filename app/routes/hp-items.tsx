import { useCallback, useEffect, useState } from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useNavigation,
  useNavigationType,
  useSearchParams,
} from "react-router";
import { Button } from "@heroui/react";
import {
  Boxes,
  LoaderCircle,
  Minus,
  Package,
  Pencil,
  Plus,
  Search,
  Settings2,
} from "lucide-react";
import type { Route } from "./+types/hp-items";
import { DataTable, Table } from "~/components/data-table";
import { FIELD, FieldError, IconAction, SelectField } from "~/components/form-fields";
import { TextInput } from "~/components/inputs";
import { SideDrawer } from "~/components/side-drawer";
import { TabLink, TabList } from "~/components/tabs";
import { notify } from "~/components/toast";
import { toApiFailure, type ApiFailure } from "~/lib/api/client";
import * as hpApi from "~/lib/api/hire-purchase";
import {
  depositFor,
  HP_CONDITION_LABELS,
  HP_ITEM_STATUS_LABELS,
  isHpItemStatus,
  marginOf,
  type HpItem,
} from "~/lib/hp-client";
import { formatGhs, parseGhsAmount, toAmountInput } from "~/lib/money";
import { requireOffice, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Inventory · Hire purchase · YADAH Dynamic Enterprise" }];
}

const LIST_ID = "hp-items";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All items" },
  { value: "active", label: HP_ITEM_STATUS_LABELS.active },
  { value: "discontinued", label: HP_ITEM_STATUS_LABELS.discontinued },
];

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);

  const url = new URL(request.url);
  const sp = url.searchParams;
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") || "20") || 20));
  const search = sp.get("search")?.trim().slice(0, 100) || undefined;
  const statusParam = sp.get("status");
  const status = isHpItemStatus(statusParam) ? statusParam : undefined;
  const inStockOnly = sp.get("inStock") === "1";

  const { data: result, headers } = await withAuth(request, (token) =>
    hpApi.listHpItems(token, { page, limit, status, search, inStockOnly }),
  );

  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));
  if (page > pageCount) {
    url.searchParams.set("page", String(pageCount));
    throw redirect(url.pathname + url.search, { headers });
  }

  return data(
    {
      result,
      filters: {
        page,
        limit,
        status: status ?? "",
        search: search ?? "",
        inStockOnly,
      },
    },
    { headers },
  );
}

type ActionData = {
  ok?: boolean;
  intent?: string;
  message?: string;
  formError?: string;
  fieldErrors?: Record<string, string>;
  /** Forwarded so the browser console shows what the API actually said. */
  failure?: ApiFailure;
};

export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      runIntent({ token, intent, id, form }),
    );
    return data<ActionData>(result, { headers });
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const failure = toApiFailure(error);

    if (failure.code === "STOCK_UNDERFLOW") {
      return data<ActionData>({
        intent,
        fieldErrors: {
          delta: "That would take the stock below zero. Count the shelf again.",
        },
        failure,
      });
    }

    return data<ActionData>({
      intent,
      formError:
        failure.status === 0
          ? "Something went wrong. Please try again."
          : failure.message,
      failure,
    });
  }
}

async function runIntent({
  token,
  intent,
  id,
  form,
}: {
  token: string;
  intent: string;
  id: string;
  form: FormData;
}): Promise<ActionData> {
  const name = String(form.get("name") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const cost = parseGhsAmount(String(form.get("costPrice") ?? ""));
  const selling = parseGhsAmount(String(form.get("sellingPrice") ?? ""));

  if (intent === "create" || intent === "update") {
    const fieldErrors: Record<string, string> = {};
    if (name.length < 2 || name.length > 120)
      fieldErrors.name = "Name must be 2–120 characters.";
    if (description && description.length > 500)
      fieldErrors.description = "Description must be under 500 characters.";
    if (cost === null || cost < 1)
      fieldErrors.costPrice = "What did Yadah pay for it?";
    if (selling === null || selling < 1)
      fieldErrors.sellingPrice = "What does the customer pay?";

    if (intent === "create") {
      const quantity = Number(form.get("quantityInStock") ?? "");
      if (!Number.isInteger(quantity) || quantity < 0)
        fieldErrors.quantityInStock = "How many are on the shelf?";
      if (Object.keys(fieldErrors).length) return { intent, fieldErrors };

      const { item } = await hpApi.createHpItem(token, {
        name,
        description: description || undefined,
        quantityInStock: quantity,
        costPrice: cost as number,
        sellingPrice: selling as number,
      });
      return {
        ok: true,
        intent,
        message: `${item.name} added — ${formatGhs(item.sellingPrice)}, deposit ${formatGhs(
          depositFor(item.sellingPrice),
        )}.`,
      };
    }

    const statusRaw = form.get("status");
    if (Object.keys(fieldErrors).length) return { intent, fieldErrors };

    const { item } = await hpApi.updateHpItem(token, id, {
      name,
      description: description || undefined,
      costPrice: cost as number,
      sellingPrice: selling as number,
      status: isHpItemStatus(statusRaw) ? statusRaw : undefined,
    });
    return { ok: true, intent, message: `${item.name} updated.` };
  }

  if (intent === "adjust") {
    const delta = Number(form.get("delta") ?? "");
    const reason = String(form.get("reason") ?? "").trim();
    const fieldErrors: Record<string, string> = {};
    if (!Number.isInteger(delta) || delta === 0)
      fieldErrors.delta = "How many in or out? Use a minus for out.";
    else if (Math.abs(delta) > 1000)
      fieldErrors.delta = "The API takes at most 1000 at a time.";
    if (reason.length < 2 || reason.length > 200)
      fieldErrors.reason = "Say why — this is written to the audit trail.";
    if (Object.keys(fieldErrors).length) return { intent, fieldErrors };

    const { item } = await hpApi.adjustHpStock(token, id, { delta, reason });
    return {
      ok: true,
      intent,
      message: `${item.name}: ${delta > 0 ? "+" : ""}${delta}, now ${item.quantityInStock} in stock.`,
    };
  }

  return { formError: "Unsupported action." };
}

/** Which item form is open. `null` is closed. */
type Editing =
  | { mode: "create" }
  | { mode: "edit"; item: HpItem }
  | { mode: "adjust"; item: HpItem }
  | null;

export default function HpItems({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { result, filters } = loaderData;
  const navigation = useNavigation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(filters.search);
  const [editing, setEditing] = useState<Editing>(null);

  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));

  const pendingSearch =
    navigation.state === "loading" && navigation.location
      ? (new URLSearchParams(navigation.location.search).get("search") ?? "")
      : null;
  const searching = pendingSearch !== null && pendingSearch !== filters.search;

  const commitSearch = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set("search", value);
          else next.delete("search");
          next.delete("page");
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setSearchParams],
  );

  // Live search: one request per pause in typing, not per keystroke.
  useEffect(() => {
    if (search === filters.search) return;
    const timer = setTimeout(() => commitSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search, filters.search, commitSearch]);

  // Back/forward moves the URL out from under the field, so adopt it.
  useEffect(() => {
    if (navigationType === "POP") setSearch(filters.search);
  }, [navigationType, filters.search]);

  useEffect(() => {
    if (actionData?.ok) {
      notify.success(actionData.message ?? "Saved.");
      setEditing(null);
    } else if (actionData?.formError) {
      notify.error(actionData.formError);
    }
    if (actionData?.failure)
      console.error("[hire-purchase] request failed:", actionData.failure);
  }, [actionData]);

  function statusHref(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("status", value);
    else next.delete("status");
    next.delete("page");
    const qs = next.toString();
    return `/hire-purchase/items${qs ? `?${qs}` : ""}`;
  }

  function setParam(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next);
  }

  return (
    <div className="mx-auto w-full px-6 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Inventory
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            What can be signed for on hire purchase. A customer pays half the
            selling price as a deposit before the item leaves the shop.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="min-h-8 rounded-md bg-success px-3"
            onPress={() => setEditing({ mode: "create" })}
          >
            <Plus size={14} />
            Add an item
          </Button>
          <Link
            to="/settings/hire-purchase"
            className="flex min-h-8 items-center gap-1.5 rounded-md border-2 border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-secondary"
          >
            <Settings2 size={12} />
            Settings
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* A real GET form, so the search still works with JavaScript off. */}
        <Form
          method="get"
          className="w-full max-w-xs"
          onSubmit={(event) => {
            event.preventDefault();
            commitSearch(search);
          }}
        >
          <div className="relative">
            <TextInput
              name="search"
              aria-label="Search inventory"
              value={search}
              onChange={setSearch}
              inputProps={{
                placeholder: "Item name",
                autoComplete: "off",
                className: `${FIELD} py-1 pl-8`,
              }}
            />
            {searching ? (
              <LoaderCircle
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-2.5 my-auto animate-spin text-success"
              />
            ) : (
              <Search
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-2.5 my-auto text-success"
              />
            )}
          </div>
        </Form>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={filters.inStockOnly}
              onChange={(event) =>
                setParam({
                  inStock: event.target.checked ? "1" : null,
                  page: null,
                })
              }
              className="size-4 rounded border-border accent-accent"
            />
            In stock only
          </label>

          <TabList label="Filter by status" className="max-w-full overflow-x-auto">
            {STATUS_OPTIONS.map((option) => (
              <TabLink
                key={option.value}
                to={statusHref(option.value)}
                selected={option.value === filters.status}
                controls={LIST_ID}
              >
                {option.label}
              </TabLink>
            ))}
          </TabList>
        </div>
      </div>

      <DataTable
        id={LIST_ID}
        columns={[
          "Item",
          "In stock",
          "Cost",
          "Sells for",
          "Deposit",
          "Margin",
          "Status",
          "Actions",
        ]}
        ariaLabel="Hire purchase inventory"
        isLoading={navigation.state === "loading" && !searching}
        page={result.page}
        pageCount={pageCount}
        onPageChange={(p) => setParam({ page: String(p) })}
        pageSize={result.limit}
        onPageSizeChange={(s) => setParam({ limit: String(s), page: "1" })}
        pageSizeOptions={[10, 20, 50, 100]}
        summary={
          searching
            ? "Searching…"
            : result.total === 0
              ? "No items"
              : `Showing ${(result.page - 1) * result.limit + 1}–${Math.min(
                  result.page * result.limit,
                  result.total,
                )} of ${result.total}`
        }
        emptyContent={{
          icon: <Package size={20} />,
          title: "Nothing in the shop",
          subtext: filters.search
            ? `Nothing matches “${filters.search}”.`
            : "Add the first item — name it, price it, and say how many there are.",
        }}
      >
        {result.items.map((item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell className="px-4 py-2 font-medium text-foreground">
              <span className="block truncate">{item.name}</span>
              {item.description && (
                <span className="block truncate text-xs font-normal text-muted">
                  {item.description}
                </span>
              )}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums">
              <span
                className={
                  item.quantityInStock === 0
                    ? "font-medium text-red-600 dark:text-red-400"
                    : "text-muted"
                }
              >
                {item.quantityInStock}
              </span>
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {formatGhs(item.costPrice, { symbol: null })}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-foreground">
              {formatGhs(item.sellingPrice, { symbol: null })}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {formatGhs(depositFor(item.sellingPrice), { symbol: null })}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {formatGhs(marginOf(item), { symbol: null })}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">
              {HP_ITEM_STATUS_LABELS[item.status]}
              {item.condition === "used" && (
                <span className="ml-1 text-xs">
                  · {HP_CONDITION_LABELS.used}
                </span>
              )}
            </Table.Cell>
            <Table.Cell className="px-4 py-2">
              <div className="flex items-center gap-1">
                <IconAction
                  label={`Edit ${item.name}`}
                  onClick={() => setEditing({ mode: "edit", item })}
                >
                  <Pencil size={16} />
                </IconAction>
                <IconAction
                  label={`Adjust stock of ${item.name}`}
                  onClick={() => setEditing({ mode: "adjust", item })}
                >
                  <Boxes size={16} />
                </IconAction>
              </div>
            </Table.Cell>
          </Table.Row>
        ))}
      </DataTable>

      <ItemDrawer
        editing={editing}
        onClose={() => setEditing(null)}
        submitting={navigation.state === "submitting"}
        fieldErrors={actionData?.fieldErrors}
      />
    </div>
  );
}

function ItemDrawer({
  editing,
  onClose,
  submitting,
  fieldErrors,
}: {
  editing: Editing;
  onClose: () => void;
  submitting: boolean;
  fieldErrors?: Record<string, string>;
}) {
  const mode = editing?.mode ?? "create";
  const item = editing && "item" in editing ? editing.item : undefined;
  const formId = `hp-item-${mode}-${item?.id ?? "new"}`;

  const title =
    mode === "create"
      ? "Add an item"
      : mode === "edit"
        ? "Edit item"
        : "Adjust stock";

  return (
    <SideDrawer
      isOpen={editing !== null}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            className="rounded-md"
            onPress={onClose}
            isDisabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            className="rounded-md bg-success"
            isDisabled={submitting}
          >
            {submitting ? "Saving…" : mode === "adjust" ? "Adjust" : "Save"}
          </Button>
        </>
      }
    >
      <Form id={formId} key={formId} method="post" className="space-y-5">
        <input
          type="hidden"
          name="intent"
          value={mode === "adjust" ? "adjust" : mode}
        />
        {item && <input type="hidden" name="id" value={item.id} />}

        {mode === "adjust" ? (
          <AdjustFields item={item} fieldErrors={fieldErrors} />
        ) : (
          <ItemFields mode={mode} item={item} fieldErrors={fieldErrors} />
        )}
      </Form>
    </SideDrawer>
  );
}

function ItemFields({
  mode,
  item,
  fieldErrors,
}: {
  mode: "create" | "edit";
  item?: HpItem;
  fieldErrors?: Record<string, string>;
}) {
  const [selling, setSelling] = useState(
    item ? toAmountInput(item.sellingPrice) : "",
  );
  const pesewas = parseGhsAmount(selling);

  return (
    <>
      <div className="space-y-1.5">
        <TextInput
          name="name"
          label="Item"
          defaultValue={item?.name}
          inputProps={{ autoComplete: "off", className: FIELD }}
        />
        <FieldError message={fieldErrors?.name} />
      </div>

      <div className="space-y-1.5">
        <TextInput
          name="description"
          label="Description (optional)"
          defaultValue={item?.description}
          inputProps={{ autoComplete: "off", className: FIELD }}
        />
        <FieldError message={fieldErrors?.description} />
      </div>

      {mode === "create" && (
        <div className="space-y-1.5">
          <TextInput
            name="quantityInStock"
            label="How many in stock"
            inputProps={{
              inputMode: "numeric",
              autoComplete: "off",
              placeholder: "0",
              className: FIELD,
            }}
          />
          <FieldError message={fieldErrors?.quantityInStock} />
          <p className="text-xs text-muted">
            Afterwards, stock only moves through an audited adjustment.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <TextInput
          name="costPrice"
          label="Cost price"
          defaultValue={item ? toAmountInput(item.costPrice) : undefined}
          inputProps={{
            inputMode: "decimal",
            autoComplete: "off",
            placeholder: "0.00",
            className: FIELD,
          }}
        />
        <FieldError message={fieldErrors?.costPrice} />
        <p className="text-xs text-muted">
          What Yadah paid. Kept for profit reporting and never shown to a
          customer.
        </p>
      </div>

      <div className="space-y-1.5">
        <TextInput
          name="sellingPrice"
          label="Selling price"
          value={selling}
          onChange={setSelling}
          inputProps={{
            inputMode: "decimal",
            autoComplete: "off",
            placeholder: "0.00",
            className: FIELD,
          }}
        />
        <FieldError message={fieldErrors?.sellingPrice} />
        {pesewas !== null && pesewas > 0 && (
          <p className="text-xs text-muted">
            Deposit at signing:{" "}
            <span className="font-medium text-foreground">
              {formatGhs(depositFor(pesewas))}
            </span>{" "}
            · financed {formatGhs(pesewas - depositFor(pesewas))}
          </p>
        )}
      </div>

      {mode === "edit" && (
        <>
          <SelectField
            name="status"
            label="Status"
            defaultValue={item?.status ?? "active"}
            options={[
              { value: "active", label: HP_ITEM_STATUS_LABELS.active },
              {
                value: "discontinued",
                label: HP_ITEM_STATUS_LABELS.discontinued,
              },
            ]}
          />
          <p className="text-xs text-muted">
            Prices here never reach an agreement already signed — those took
            their own copy at signing.
          </p>
        </>
      )}
    </>
  );
}

function AdjustFields({
  item,
  fieldErrors,
}: {
  item?: HpItem;
  fieldErrors?: Record<string, string>;
}) {
  const [delta, setDelta] = useState("");
  const parsed = Number(delta);
  const after =
    item && Number.isInteger(parsed) ? item.quantityInStock + parsed : null;

  return (
    <>
      <p className="text-sm text-muted">
        <span className="font-medium text-foreground">{item?.name}</span> — {" "}
        {item?.quantityInStock} in stock now.
      </p>

      <div className="space-y-1.5">
        <TextInput
          name="delta"
          label="In or out"
          value={delta}
          onChange={setDelta}
          inputProps={{
            inputMode: "numeric",
            autoComplete: "off",
            placeholder: "e.g. 5, or -2",
            className: FIELD,
          }}
        />
        <div className="flex gap-2">
          <StepButton onClick={() => setDelta(String((parsed || 0) + 1))}>
            <Plus size={12} /> One in
          </StepButton>
          <StepButton onClick={() => setDelta(String((parsed || 0) - 1))}>
            <Minus size={12} /> One out
          </StepButton>
        </div>
        <FieldError message={fieldErrors?.delta} />
        {after !== null && parsed !== 0 && (
          <p
            className={`text-xs ${
              after < 0 ? "text-red-600 dark:text-red-400" : "text-muted"
            }`}
          >
            {after < 0
              ? "That would take the shelf below zero — the API refuses it."
              : `Leaves ${after} in stock.`}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <TextInput
          name="reason"
          label="Reason"
          inputProps={{
            autoComplete: "off",
            placeholder: "Damaged in transit, recount, new delivery…",
            className: FIELD,
          }}
        />
        <FieldError message={fieldErrors?.reason} />
        <p className="text-xs text-muted">
          Written to the audit trail, so whoever reconciles the shelf later can
          read why it moved. 2–200 characters.
        </p>
      </div>
    </>
  );
}

function StepButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-8 flex-1 items-center justify-center gap-1 rounded-md border-2 border-border text-xs font-medium text-muted transition-colors hover:text-foreground"
    >
      {children}
    </button>
  );
}
