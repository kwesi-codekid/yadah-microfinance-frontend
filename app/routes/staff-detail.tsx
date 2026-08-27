import {
  BanIcon,
  CircleCheckIcon,
  KeyRoundIcon,
  PencilIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { data, Link, useFetcher, useLocation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { disableUser, enableUser, getUser, listUsers, resetUserPassword } from "~/api/users";
import { ResetPasswordDialog, RoleBadge, StatusPill } from "~/components/staff-form";
import { SheetActions, SheetBody, RouteSheet } from "~/components/route-sheet";
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
import { initialsOf, ROLE_LABELS } from "~/lib/auth";
import {
  checkPassword,
  ROLE_BLURBS,
  type ResolvedStatus,
  type Staff,
  type StaffActionResult,
} from "~/lib/staff";
import { requireAdmin, requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/staff-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.staff.name ?? "Staff";
  return [{ title: `${name} · Yadah Dynamic Enterprise` }];
}

/** The API's ceiling on a page — how much of the disabled set can be read. */
const MAX_LIMIT = 100;

export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireOffice(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const [{ user }, disabled] = await Promise.all([
        getUser(token, params.id),
        // `PublicUser` carries no status, and there is no endpoint that answers
        // "is this one disabled". The disabled listing is the only source.
        listUsers(token, { status: "disabled", limit: MAX_LIMIT }),
      ]);
      return { user, disabled };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  const { user, disabled } = result;
  const resolved = disabled.total <= disabled.items.length;
  const status: ResolvedStatus = !resolved
    ? "unknown"
    : disabled.items.some((u) => u.id === user.id)
      ? "disabled"
      : "active";

  return data(
    {
      staff: user,
      status,
      canManage: viewer.role === "admin",
      isSelf: user.id === viewer.id,
    },
    { headers },
  );
}

type ActionResult = StaffActionResult;

/** Disable, re-enable and reset a password — admin only, as the API insists. */
export async function action({ request, params }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const newPassword = String(form.get("newPassword") ?? "");

  if (params.id === admin.id && intent !== "reset-password") {
    return data<ActionResult>(
      { ok: false, message: "You cannot disable your own account." },
      { status: 400 },
    );
  }
  if (intent === "reset-password") {
    const issue = checkPassword(newPassword);
    if (issue) return data<ActionResult>({ ok: false, message: issue }, { status: 400 });
  }

  try {
    const { data: message, headers } = await withAuth(request, async (token) => {
      if (intent === "disable") {
        await disableUser(token, params.id);
        return "Staff member disabled. Every session they held is closed.";
      }
      if (intent === "enable") {
        await enableUser(token, params.id);
        return "Staff member re-enabled.";
      }
      if (intent === "reset-password") {
        await resetUserPassword(token, params.id, newPassword);
        return "Password reset. Hand the new one over — they are signed out everywhere.";
      }
      throw new Response("Unknown action.", { status: 400 });
    });
    return data<ActionResult>({ ok: true, message }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return data<ActionResult>(
        { ok: false, message: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}

/**
 * One staff account, read-only, in the drawer the row opened. It carries the
 * same ruled sections and small-caps labels as the customer record, stacked
 * into one column because a drawer only has the one.
 */
export default function StaffDetail({ loaderData }: Route.ComponentProps) {
  const { staff, status, canManage, isSelf } = loaderData;
  const { search } = useLocation();

  return (
    <RouteSheet backTo="/staff" title={staff.name} description={`@${staff.username}`}>
      <SheetBody className="space-y-6">
        {/* Who this is, at a glance — the same avatar the row carries, so the
            drawer visibly belongs to the line that opened it. */}
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-12 shrink-0 items-center justify-center rounded-full text-base font-semibold"
            style={{
              backgroundColor: `var(--tint-${tintIndex(staff.id)}-bg)`,
              color: `var(--tint-${tintIndex(staff.id)}-fg)`,
            }}
          >
            {initialsOf(staff.name)}
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <RoleBadge role={staff.role} />
            <StatusPill status={status} />
            {isSelf && <span className="text-sm text-muted-foreground">This is you</span>}
          </div>
        </div>

        {status === "disabled" && (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            This account is disabled. Every session it held was closed and it
            cannot sign in until an admin re-enables it. Its name stays on every
            record it touched.
          </p>
        )}

        <Section title="Account">
          <Fld label="Full name" value={staff.name} />
          <Fld label="Username" value={`@${staff.username}`} />
          <Fld
            label="Role"
            value={ROLE_LABELS[staff.role]}
            hint={ROLE_BLURBS[staff.role]}
          />
        </Section>

        <Section title="Contact">
          <Fld label="Phone" value={staff.phone} tabular />
          <Fld label="Email" value={staff.email} />
        </Section>

        <Section title="Access">
          <Fld
            label="Status"
            value={
              status === "unknown"
                ? undefined
                : status === "active"
                  ? "Active"
                  : "Disabled"
            }
            hint={
              status === "unknown"
                ? "The API does not return a status on an account. Filter the staff list by Disabled to check."
                : undefined
            }
          />
          <Fld
            label="Password"
            value="Set by an admin"
            hint="It is never shown. Reset it to issue a new one."
          />
        </Section>
      </SheetBody>

      {canManage && (
        <StaffActions staff={staff} status={status} isSelf={isSelf} search={search} />
      )}
    </RouteSheet>
  );
}

/** Edit · Reset password · Disable or Enable, pinned under the record. */
function StaffActions({
  staff,
  status,
  isSelf,
  search,
}: {
  staff: Staff;
  status: ResolvedStatus;
  isSelf: boolean;
  search: string;
}) {
  const fetcher = useFetcher<ActionResult>();
  const [confirm, setConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      toast.success(fetcher.data.message);
      setResetting(false);
    } else {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data]);

  const submit = (intent: "disable" | "enable") =>
    fetcher.submit({ intent }, { method: "post" });

  return (
    <SheetActions className="justify-between">
      {status === "disabled" ? (
        <Button variant="outline" size="sm" onClick={() => submit("enable")}>
          <CircleCheckIcon />
          Enable
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={isSelf}
          title={isSelf ? "You cannot disable your own account." : undefined}
          onClick={() => setConfirm(true)}
        >
          <BanIcon />
          Disable
        </Button>
      )}

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setResetting(true)}>
          <KeyRoundIcon />
          Reset password
        </Button>
        <Button asChild size="sm">
          <Link to={`/staff/${staff.id}/edit${search}`} prefetch="intent">
            <PencilIcon />
            Edit
          </Link>
        </Button>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable {staff.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They are signed out everywhere immediately and cannot sign in
              again until an admin re-enables them. Their name stays on every
              record they touched. Nothing is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => submit("disable")}
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ResetPasswordDialog
        open={resetting}
        onOpenChange={setResetting}
        name={staff.name}
        userId={staff.id}
        fetcher={fetcher}
      />
    </SheetActions>
  );
}

/* ---------------------------------------------------------- the record, read --- */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="space-y-4 border-t border-border pt-4">{children}</div>
    </section>
  );
}

function Fld({
  label,
  value,
  hint,
  tabular,
}: {
  label: string;
  value?: string | null;
  hint?: string;
  tabular?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={cn(
          "text-sm wrap-break-word",
          value ? "text-foreground" : "text-muted-foreground",
          value && tabular && "tabular",
        )}
      >
        {value || "—"}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function tintIndex(id: string): number {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum = (sum + id.charCodeAt(i)) % 6;
  return sum + 1;
}
