import {
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Form,
  Link,
  Outlet,
  useActionData,
  useFetcher,
  useLocation,
  useNavigation,
  useSubmit,
} from "react-router";
import { toast } from "sonner";

import {
  ListingCard,
  ListingFooter,
  ListingToolbar,
  SearchBox,
  StatusPill,
  Th,
} from "~/components/listing";
import { BackLink, Page } from "~/components/page";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";
import { formatCount, formatPesewas } from "~/lib/format";
import { ITEM_STATUS_LABELS, type ItemLabel, type LabelKind } from "~/lib/hire-purchase";
import {
  LABEL_COPY,
  LABEL_PAGE_SIZE as PAGE_SIZE,
  capitalise,
  type LabelActionResult as ActionResult,
  type LabelDetailData,
  type LabelFormData,
  type LabelListData,
} from "~/lib/labels";
import { cn } from "~/lib/utils";

/**
 * Brands and categories: the two lists everything on the shelf is filed
 * under. The same three screens for each — the list, one label with its
 * items, and the drawer that adds or renames one — so they are drawn here
 * once and each route module says which kind it is. Their loaders and
 * actions live in `~/lib/label-book.server`.
 *
 * Adding and renaming are counter work, like the shelf itself. Deleting is
 * the office's, and the API refuses it while any item is still filed under
 * the label — a rename is the fix for a wrong name, not a delete.
 */

/* -------------------------------------------------------------------- list --- */

function listHref(kind: LabelKind, search: string, page = 1): string {
  const p = new URLSearchParams();
  if (search) p.set("search", search);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `${LABEL_COPY[kind].path}?${s}` : LABEL_COPY[kind].path;
}

export function LabelList({ data: page }: { data: LabelListData }) {
  const { kind, canDelete, search, total, rows } = page;
  const copy = LABEL_COPY[kind];
  const navigation = useNavigation();
  const submit = useSubmit();
  const location = useLocation();
  const busy =
    navigation.state === "loading" && navigation.location?.pathname === copy.path;

  return (
    <Page className="max-w-none">
      <ListingCard>
        <ListingToolbar>
          <SearchBox
            value={search}
            apply={(next) =>
              submit(next ? { search: next } : {}, {
                replace: true,
                preventScrollReset: true,
              })
            }
            hidden={{}}
            placeholder={`Search ${copy.many}`}
            label={`Search ${copy.many}`}
            busy={busy}
          />
          <Button asChild size="sm">
            <Link to={`${copy.path}/new${location.search}`} prefetch="intent" preventScrollReset>
              <PlusIcon />
              Add {copy.one}
            </Link>
          </Button>
        </ListingToolbar>

        {rows.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <copy.icon className="size-6" />
              </EmptyMedia>
              <EmptyTitle>{search ? "No matches" : `No ${copy.many} yet`}</EmptyTitle>
              <EmptyDescription>
                {search
                  ? `Nothing matched “${search}”.`
                  : `Add one and items can be filed under it.`}
              </EmptyDescription>
            </EmptyHeader>
            {search ? (
              <Button asChild variant="outline" size="sm">
                <Link to={copy.path}>Clear the search</Link>
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link to={`${copy.path}/new`}>
                  <PlusIcon />
                  Add {copy.one}
                </Link>
              </Button>
            )}
          </Empty>
        ) : (
          <div className={cn("transition-opacity", busy && "opacity-60")}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>{capitalise(copy.one)}</Th>
                  <Th className="text-right">Products</Th>
                  <Th className="w-12 text-right">Actions</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <LabelRow key={row.id} kind={kind} row={row} canDelete={canDelete} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <ListingFooter
          page={page.page}
          pageSize={PAGE_SIZE}
          total={total}
          hrefFor={(p) => listHref(kind, search, p)}
        />
      </ListingCard>

      {/* The add drawer renders here, over the list. */}
      <Outlet />
    </Page>
  );
}

function LabelRow({
  kind,
  row,
  canDelete,
}: {
  kind: LabelKind;
  row: ItemLabel;
  canDelete: boolean;
}) {
  const copy = LABEL_COPY[kind];
  const fetcher = useFetcher<ActionResult>();
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) toast.success(fetcher.data.message);
    else toast.error(fetcher.data.message);
  }, [fetcher.data]);

  const to = `${copy.path}/${row.id}`;

  return (
    <>
      <TableRow className="group">
        <TableCell className="px-4 py-3">
          <Link to={to} prefetch="intent" className="font-medium hover:underline">
            {row.name}
          </Link>
          {row.description && (
            <p className="truncate text-xs text-muted-foreground">{row.description}</p>
          )}
        </TableCell>
        <TableCell
          className={cn(
            "tabular px-4 py-3 text-right",
            row.itemCount === 0 && "text-muted-foreground",
          )}
        >
          {formatCount(row.itemCount)}
        </TableCell>
        <TableCell className="px-4 py-3 text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontalIcon />
                <span className="sr-only">Actions for {row.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem asChild>
                <Link to={to} prefetch="intent">
                  <copy.icon />
                  Open
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`${to}/edit`} prefetch="intent">
                  <PencilIcon />
                  Rename or describe
                </Link>
              </DropdownMenuItem>
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  {/* Greyed while items are filed under it, which is how every
                      row menu here says "not yet" rather than hiding the entry. */}
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={row.itemCount > 0}
                    onSelect={(event) => {
                      event.preventDefault();
                      setConfirm(true);
                    }}
                  >
                    <Trash2Icon />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {row.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              There is no trash for a {copy.one}; this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => fetcher.submit({ id: row.id }, { method: "post" })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ------------------------------------------------------------------ detail --- */

export function LabelDetail({ data: page }: { data: LabelDetailData }) {
  const { kind, label, items } = page;
  const copy = LABEL_COPY[kind];

  return (
    <Page className="max-w-none">
      <BackLink to={copy.path} className="mb-4">
        All {copy.many}
      </BackLink>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-heading text-2xl font-bold tracking-tight">{label.name}</h2>
          <p className="text-sm text-muted-foreground">
            {formatCount(label.itemCount)} {label.itemCount === 1 ? "product" : "products"}
            {label.description ? ` · ${label.description}` : ""}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to={`${copy.path}/${label.id}/edit`} prefetch="intent" preventScrollReset>
            <PencilIcon />
            Rename or describe
          </Link>
        </Button>
      </header>

      <ListingCard>
        {items.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <copy.icon className="size-6" />
              </EmptyMedia>
              <EmptyTitle>Nothing filed under {label.name}</EmptyTitle>
              <EmptyDescription>
                Add an item and choose this {copy.one}, or edit one already on the shelf.
              </EmptyDescription>
            </EmptyHeader>
            <Button asChild size="sm">
              <Link to="/inventory/new">
                <PlusIcon />
                Add item
              </Link>
            </Button>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <Th>Item</Th>
                <Th className="text-right">In stock</Th>
                <Th className="text-right">Selling price</Th>
                <Th>Status</Th>
                <Th className="w-12 text-right">Actions</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id} className="group">
                  <TableCell className="px-4 py-3">
                    <p className="truncate font-medium">{row.name}</p>
                    {row.detail && (
                      <p className="truncate text-xs text-muted-foreground">{row.detail}</p>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "tabular px-4 py-3 text-right font-medium whitespace-nowrap",
                      row.quantityInStock <= 0 && "text-muted-foreground",
                    )}
                  >
                    {row.quantityInStock <= 0 ? "Out of stock" : formatCount(row.quantityInStock)}
                  </TableCell>
                  <TableCell className="tabular px-4 py-3 text-right whitespace-nowrap">
                    {formatPesewas(row.sellingPrice)}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <StatusPill
                      label={ITEM_STATUS_LABELS[row.status]}
                      tone={row.sellable ? "success" : "muted"}
                    />
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/inventory/${row.id}/edit`} prefetch="intent">
                        <PencilIcon />
                        Edit
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListingCard>

      {/* The rename drawer renders here, over the page. */}
      <Outlet />
    </Page>
  );
}

/* -------------------------------------------------------------------- form --- */

export function LabelForm({ data: page }: { data: LabelFormData }) {
  const { kind, label } = page;
  const copy = LABEL_COPY[kind];
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [name, setName] = useState(label?.name ?? "");

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo={label ? `${copy.path}/${label.id}` : copy.path}
      title={label ? label.name : `Add a ${copy.one}`}
      description={label ? `Rename or describe this ${copy.one}` : undefined}
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {actionData?.error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <p className="font-medium">{actionData.error}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label
              htmlFor="name"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Name<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              autoComplete="off"
              maxLength={60}
              placeholder={kind === "brand" ? "Nasco" : "Fridge"}
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="description"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Description
            </Label>
            <Textarea
              id="description"
              name="description"
              defaultValue={label?.description ?? ""}
              rows={3}
              maxLength={300}
            />
          </div>
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting || name.trim().length === 0}>
            {submitting && <Loader2Icon className="animate-spin" />}
            {label ? "Save changes" : `Add ${copy.one}`}
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}

