import { ListOrderedIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { formatCount } from "~/lib/format";

/** What renumbering this month's accounts did, or would do — the API's report. */
export interface RenumberReport {
  apply: boolean;
  changes: { from: string; to: string }[];
  /** The product's counter after the run; the next account is this plus one. */
  counter: number;
}

/** What a list route's action answers a renumbering request with. */
export type RenumberResult = { ok: true; report: RenumberReport } | { ok: false; message: string };

/**
 * Bring this month's account numbers into the continuing sequence, from a
 * book's toolbar (user request, 1 Oct 2026). Two steps, so nothing is written
 * on a click: opening the dialog previews each change — SV26100001 →
 * SV26100361 and so on — and Apply then writes them, behind a confirmation.
 * Office only, and the API says so again. `action` is the list route whose
 * action forwards `renumber-preview` and `renumber-apply` to the API.
 */
export function RenumberButton({ action, product }: { action: string; product: string }) {
  const fetcher = useFetcher<RenumberResult>();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;
  const preview = result?.ok && !result.report.apply ? result.report : null;

  const run = (apply: boolean) =>
    fetcher.submit(
      { intent: apply ? "renumber-apply" : "renumber-preview" },
      { method: "post", action },
    );

  useEffect(() => {
    if (fetcher.state !== "idle" || !result) return;
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    if (result.report.apply) {
      const n = result.report.changes.length;
      toast.success(
        n === 0 ? "Nothing to renumber." : `${formatCount(n)} account${n === 1 ? "" : "s"} renumbered.`,
        {
          description: `The next ${product} account will be number ${formatCount(result.report.counter + 1)}.`,
        },
      );
      setOpen(false);
      setConfirm(false);
    }
  }, [fetcher.state, result, product]);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
          setConfirm(false);
          run(false);
        }}
      >
        <ListOrderedIcon />
        Fix this month&rsquo;s numbers
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Fix this month&rsquo;s numbers</DialogTitle>
            <DialogDescription>
              {product[0]?.toUpperCase()}
              {product.slice(1)} accounts opened this month restarted at 0001. This carries them
              on from where last month ended, in the order they were opened.
            </DialogDescription>
          </DialogHeader>

          {busy && !preview ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Checking the accounts…
            </p>
          ) : preview ? (
            preview.changes.length === 0 ? (
              <p className="rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-sm">
                Every account this month already follows the sequence. Nothing to do.
              </p>
            ) : (
              <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
                {preview.changes.map((c) => (
                  <li key={c.from} className="tabular flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-muted-foreground">#{c.from}</span>
                    <span className="font-medium">#{c.to}</span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
          )}

          {preview && preview.changes.length > 0 && (
            <p className="text-xs text-muted-foreground">
              The next account opened will be number {formatCount(preview.counter + 1)}.
            </p>
          )}

          {confirm && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              This changes the numbers on the live accounts and cannot be undone from here.
              Apply it?
            </p>
          )}

          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {confirm ? (
              <Button
                disabled={busy || !preview}
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => run(true)}
              >
                {busy ? <Loader2Icon className="animate-spin" /> : <ListOrderedIcon />}
                Yes, apply
              </Button>
            ) : (
              <Button
                disabled={busy || !preview || preview.changes.length === 0}
                onClick={() => setConfirm(true)}
              >
                Apply
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
