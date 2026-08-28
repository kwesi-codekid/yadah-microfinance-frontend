import { MoreHorizontalIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";

import { Th, ListingCard, ListingFooter } from "~/components/listing";
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
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { formatAccraDate, relativeDayLabel } from "~/lib/format";

/**
 * One book of the trash, as every book draws it: what was removed, why, when,
 * and a ⋯ menu whose only item is the way back. Each route under the trash
 * rail maps its own records into `TrashRow`s and hands them here, so a
 * trashed loan and a trashed customer read the same way.
 *
 * `restore` is what the row menu says; the row's `id` is posted back to the
 * route's own action as `id`, and that action decides which API call it is.
 */

export interface TrashRow {
  id: string;
  /** The first column: the name the branch knows the record by. */
  title: string;
  /** Under the title — a phone, an account number, an item. */
  subtitle?: string;
  /** A second column, for the figure or state worth seeing before restoring. */
  detail?: ReactNode;
  reason: string | null;
  deletedAt: string;
}

/** Map the API's `deletedAt` and `deleteReason` once, so every book agrees. */
export function trashMeta(record: { deletedAt: string; deleteReason?: string | null }) {
  return { reason: record.deleteReason ?? null, deletedAt: record.deletedAt };
}

export function TrashList({
  rows,
  page,
  pageSize,
  total,
  hrefFor,
  noun,
  detailHeading,
  emptyTitle,
  emptyDescription,
  backTo,
  backLabel,
  restoreDescription,
}: {
  rows: TrashRow[];
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
  /** "customer", "loan" — for the sr-only labels. */
  noun: string;
  detailHeading?: string;
  emptyTitle: string;
  emptyDescription: string;
  backTo: string;
  backLabel: string;
  /** What restoring means for this kind of record, in one or two sentences. */
  restoreDescription: string;
}) {
  const now = new Date();

  return (
    <ListingCard>
      {rows.length === 0 ? (
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Trash2Icon className="size-6" />
            </EmptyMedia>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
          <Button asChild variant="outline" size="sm">
            <Link to={backTo}>{backLabel}</Link>
          </Button>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <Th>{capitalise(noun)}</Th>
              {detailHeading ? (
                <Th className="hidden sm:table-cell">{detailHeading}</Th>
              ) : null}
              <Th className="hidden lg:table-cell">Reason</Th>
              <Th>Removed</Th>
              <Th className="w-12 text-right">Actions</Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="px-4 py-3">
                  <p className="truncate font-medium">{row.title}</p>
                  {row.subtitle ? (
                    <p className="tabular truncate text-xs text-muted-foreground">
                      {row.subtitle}
                    </p>
                  ) : null}
                </TableCell>
                {detailHeading ? (
                  <TableCell className="hidden px-4 py-3 text-sm sm:table-cell">
                    {row.detail ?? "—"}
                  </TableCell>
                ) : null}
                <TableCell className="hidden max-w-xs px-4 py-3 text-sm text-muted-foreground lg:table-cell">
                  {row.reason ?? "—"}
                </TableCell>
                <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                  <p>{relativeDayLabel(row.deletedAt, now)}</p>
                  <p className="text-xs">{formatAccraDate(row.deletedAt)}</p>
                </TableCell>
                <TableCell className="px-4 py-3 text-right">
                  <RestoreMenu row={row} noun={noun} description={restoreDescription} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ListingFooter page={page} pageSize={pageSize} total={total} hrefFor={hrefFor} />
    </ListingCard>
  );
}

function RestoreMenu({
  row,
  noun,
  description,
}: {
  row: TrashRow;
  noun: string;
  description: string;
}) {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const [confirm, setConfirm] = useState(false);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) toast.success(fetcher.data.message);
      else toast.error(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            className="text-muted-foreground hover:text-foreground"
          >
            <MoreHorizontalIcon />
            <span className="sr-only">
              Actions for {noun} {row.title}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setConfirm(true);
            }}
          >
            <RotateCcwIcon />
            Restore
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore {row.title}?</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => fetcher.submit({ id: row.id }, { method: "post" })}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
