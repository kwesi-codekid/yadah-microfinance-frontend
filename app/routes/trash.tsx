import {
  ChevronLeftIcon,
  ChevronRightIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { data, Link, useFetcher } from "react-router";
import { toast } from "sonner";

import { listTrashedCustomers, restoreCustomer } from "~/api/customers";
import { ApiError } from "~/api/error";
import { Page } from "~/components/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
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
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { initialsOf } from "~/lib/auth";
import { formatAccraDate, formatCount, relativeDayLabel } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/trash";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Trash · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page, and the line under it. */
export const handle = {
  title: "Trash",
  description:
    "Customers that were removed from the listings. Nothing here is deleted for good — restore one and it reappears everywhere.",
};

const PAGE_SIZE = 20;

/**
 * `GET /customers/trash` — customers that were soft-deleted, newest first.
 * Office only. The rail hides this item for collectors; this is what enforces
 * it.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: list, headers } = await withAuth(request, (token) =>
    listTrashedCustomers(token, { page, limit: PAGE_SIZE }),
  );

  const now = new Date();
  const rows = list.items.map((c) => ({
    id: c.id,
    fullName: c.fullName,
    initials: initialsOf(c.fullName),
    phone: c.phone,
    reason: c.deleteReason ?? null,
    deleted: relativeDayLabel(c.deletedAt, now),
    deletedOn: formatAccraDate(c.deletedAt),
  }));

  return data({ rows, page, total: list.total }, { headers });
}

/** `POST /customers/:id/restore` — bring one back into the listings. */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const id = String(form.get("customerId") ?? "");
  if (!id) return data({ ok: false, message: "Missing customer." }, { status: 400 });

  try {
    const { data: message, headers } = await withAuth(request, async (token) => {
      await restoreCustomer(token, id);
      return "Customer restored.";
    });
    return data({ ok: true, message }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ ok: false, message: error.message }, { status: error.status });
    }
    throw error;
  }
}

export default function Trash({ loaderData }: Route.ComponentProps) {
  const { rows, page, total } = loaderData;
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  return (
    <Page className="max-w-none">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Trash2Icon className="size-6" />
              </EmptyMedia>
              <EmptyTitle>The trash is empty</EmptyTitle>
              <EmptyDescription>
                Customers moved to the trash from the customer list will wait here.
              </EmptyDescription>
            </EmptyHeader>
            <Button asChild variant="outline" size="sm">
              <Link to="/customers">Go to customers</Link>
            </Button>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <Th>Customer</Th>
                <Th className="hidden sm:table-cell">Phone</Th>
                <Th className="hidden lg:table-cell">Reason</Th>
                <Th>Removed</Th>
                <Th className="w-32 text-right">Actions</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                      >
                        {row.initials}
                      </span>
                      <p className="truncate font-medium">{row.fullName}</p>
                    </div>
                  </TableCell>
                  <TableCell className="tabular hidden px-4 py-3 text-sm sm:table-cell">
                    {row.phone}
                  </TableCell>
                  <TableCell className="hidden max-w-xs px-4 py-3 text-sm text-muted-foreground lg:table-cell">
                    {row.reason ?? "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                    <p>{row.deleted}</p>
                    <p className="text-xs">{row.deletedOn}</p>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <RestoreButton id={row.id} fullName={row.fullName} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {total > 0 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
            <p>
              Showing <span className="tabular font-medium text-foreground">{first}</span>
              –<span className="tabular font-medium text-foreground">{last}</span> of{" "}
              <span className="tabular font-medium text-foreground">{formatCount(total)}</span>
            </p>
            <div className="flex items-center gap-2">
              <Pager to={`/trash?page=${page - 1}`} disabled={page <= 1} label="Previous page">
                <ChevronLeftIcon />
                Prev
              </Pager>
              <Pager to={`/trash?page=${page + 1}`} disabled={last >= total} label="Next page">
                Next
                <ChevronRightIcon />
              </Pager>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}

function RestoreButton({ id, fullName }: { id: string; fullName: string }) {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) toast.success(fetcher.data.message);
      else toast.error(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          <RotateCcwIcon />
          Restore
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restore {fullName}?</AlertDialogTitle>
          <AlertDialogDescription>
            They reappear in the customer list and in lookups, with their
            registration record and history intact.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => fetcher.submit({ customerId: id }, { method: "post" })}
          >
            Restore
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Th({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <TableHead
      className={cn(
        "h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </TableHead>
  );
}

function Pager({
  to,
  disabled,
  label,
  children,
}: {
  to: string;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled aria-label={label}>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={to} aria-label={label} prefetch="intent">
        {children}
      </Link>
    </Button>
  );
}
