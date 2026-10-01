import { DatabaseZapIcon, Loader2Icon } from "lucide-react";
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
import type { SusuMigrationReport } from "~/api/susu";
import { formatAmount, formatCount } from "~/lib/format";

/** What the list route's action answers a migration request with. */
export type MigrateResult =
  | { ok: true; report: SusuMigrationReport }
  | { ok: false; message: string };

/**
 * The susu data update, run from the book's toolbar (user request, 30 Sep
 * 2026). Two steps, so nothing is written on a click: opening the dialog runs
 * a dry run and shows what would change; Apply then writes it, behind a
 * confirmation. Admin only, and the API says so again.
 */
export function SusuMigrateButton() {
  const fetcher = useFetcher<MigrateResult>();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;
  const preview = result?.ok && !result.report.apply ? result.report : null;

  const run = (apply: boolean) =>
    fetcher.submit({ intent: apply ? "migrate-apply" : "migrate-preview" }, { method: "post", action: "/susu" });

  useEffect(() => {
    if (fetcher.state !== "idle" || !result) return;
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    if (result.report.apply) {
      const r = result.report;
      toast.success("Susu data updated.", {
        description: `${formatCount(r.migration.books)} book${r.migration.books === 1 ? "" : "s"} → plans · ${formatCount(r.backfill.payouts)} withdrawal${r.backfill.payouts === 1 ? "" : "s"} given plan shares.`,
      });
      setOpen(false);
      setConfirm(false);
    }
  }, [fetcher.state, result]);

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
        <DatabaseZapIcon />
        Update susu data
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Update susu data</DialogTitle>
            <DialogDescription>
              Old per-cycle books become one account with plans, and withdrawals that name no
              plan get their plan shares. This is what a run would change now.
            </DialogDescription>
          </DialogHeader>

          {busy && !preview ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Checking the data…
            </p>
          ) : preview ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Row label="Customers with old books" value={formatCount(preview.migration.customers)} />
              <Row label="Books → plans" value={formatCount(preview.migration.books)} />
              <Row label="Deposits rewritten" value={formatCount(preview.migration.deposits)} />
              <Row label="Payouts labelled" value={formatCount(preview.migration.payoutsLabelled)} />
              <Row
                label="Commission taken now"
                value={`GH₵ ${formatAmount(preview.migration.commissionTakenNow)}`}
              />
              <Row
                label="Money reconciles"
                value={preview.drift === 0 ? "Yes" : `No — drift GH₵ ${formatAmount(preview.drift)}`}
                tone={preview.drift === 0 ? undefined : "danger"}
              />
              <Row label="Withdrawals to give shares" value={formatCount(preview.backfill.payouts)} />
              <Row
                label="Left loose"
                value={`GH₵ ${formatAmount(preview.backfill.loose)}`}
              />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
          )}

          {preview &&
            preview.migration.books === 0 &&
            preview.backfill.payouts === 0 && (
              <p className="rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-sm">
                Everything is already in the new shape. Nothing to do.
              </p>
            )}

          {confirm && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              This writes to the live data and cannot be undone from here. Apply it?
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
                {busy ? <Loader2Icon className="animate-spin" /> : <DatabaseZapIcon />}
                Yes, apply
              </Button>
            ) : (
              <Button
                disabled={
                  busy ||
                  !preview ||
                  preview.drift !== 0 ||
                  (preview.migration.books === 0 && preview.backfill.payouts === 0)
                }
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

function Row({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={tone === "danger" ? "tabular font-medium text-destructive" : "tabular font-medium"}>
        {value}
      </dd>
    </>
  );
}
