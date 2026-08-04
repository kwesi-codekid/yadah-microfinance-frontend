import { useEffect, useState } from "react";
import { data, redirect, useNavigation } from "react-router";
import { Button } from "@heroui/react";
import { Ban, KeyRound, Pencil, RotateCcw, TriangleAlert } from "lucide-react";
import type { Route } from "./+types/staff-detail";
import { Breadcrumbs } from "~/components/breadcrumbs";
import {
  RoleBadge,
  StaffDrawer,
  StatusForm,
  type DrawerState,
} from "~/components/staff-forms";
import { notify } from "~/components/toast";
import { ApiError, throwAsRouteError } from "~/lib/api/client";
import * as usersApi from "~/lib/api/users";
import { requireUser, withAuth } from "~/lib/session.server";
import {
  runStaffIntent,
  type StaffActionData,
} from "~/lib/staff-intents.server";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `${loaderData?.member.name ?? "Staff"} · Staff · YADAH Dynamic Enterprise`,
    },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  // Same gate as the directory: admin + manager only.
  if (user.role !== "admin" && user.role !== "manager") {
    throw redirect("/dashboard");
  }

  const { data: result, headers } = await withAuth(request, async (token) => {
    const { user: member } = await usersApi.getUser(token, params.id);
    // `PublicUser` carries no status, so ask whether the active list holds them.
    const active = await usersApi
      .listUsers(token, { status: "active", search: member.username, limit: 20 })
      .catch(() => null);
    return {
      member,
      status: active
        ? active.items.some((item) => item.id === member.id)
          ? ("active" as const)
          : ("disabled" as const)
        : null,
    };
  }).catch(throwAsRouteError); // 404

  return data(
    {
      member: result.member,
      /** Null when the active list couldn't be read — say so rather than guess. */
      status: result.status,
      canManage: user.role === "admin",
      isSelf: user.id === result.member.id,
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  if (user.role !== "admin") {
    return data<StaffActionData>({
      formError: "Only administrators can manage staff.",
    });
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      runStaffIntent({ token, intent, id: params.id, form }),
    );
    return data<StaffActionData>(result, { headers });
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const message =
      error instanceof ApiError
        ? error.message
        : "Something went wrong. Please try again.";
    return data<StaffActionData>({ intent, formError: message });
  }
}

export default function StaffDetail({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { member, status, canManage, isSelf } = loaderData;
  const navigation = useNavigation();
  const [drawer, setDrawer] = useState<DrawerState>(null);

  useEffect(() => {
    if (actionData?.ok) {
      notify.success(actionData.message ?? "Done.");
      setDrawer(null);
    } else if (actionData?.formError) {
      notify.error(actionData.formError);
    }
  }, [actionData]);

  return (
    <div className="mx-auto w-full px-6 py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs
          items={[
            { label: "Staff", to: "/staff" },
            { label: member.name },
          ]}
        />

        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-9 rounded-md bg-success px-3"
              onPress={() => setDrawer({ mode: "edit", user: member })}
            >
              <Pencil size={14} />
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-9 rounded-md border-2 border-border px-3"
              onPress={() => setDrawer({ mode: "reset", user: member })}
            >
              <KeyRound size={14} />
              Reset password
            </Button>
            {/* Signing yourself out of the app is never the intended click. */}
            {!isSelf && status !== "disabled" && (
              <StatusForm
                id={member.id}
                name={member.name}
                intent="disable"
                label="Disable"
                danger
              >
                <Ban size={16} />
              </StatusForm>
            )}
            {!isSelf && status !== "active" && (
              <StatusForm
                id={member.id}
                name={member.name}
                intent="enable"
                label="Enable"
              >
                <RotateCcw size={16} />
              </StatusForm>
            )}
          </div>
        )}
      </div>

      <section className="rounded-lg border-2 border-border bg-surface p-5 dark:bg-canvas">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            {member.name}
          </h1>
          <RoleBadge role={member.role} />
          {status && (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                status === "active"
                  ? "bg-success/10 text-success"
                  : "bg-surface-secondary text-muted"
              }`}
            >
              {status === "active" ? "Active" : "Disabled"}
            </span>
          )}
        </div>

        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <Detail label="Username" value={member.username} />
          <Detail label="Phone" value={member.phone} />
          <Detail label="Email" value={member.email ?? "—"} />
          <Detail label="Staff id" value={member.id} mono />
        </dl>

        {member.mustChangePassword && (
          <p className="mt-4 flex gap-1.5 rounded-md bg-warning/10 px-2.5 py-1.5 text-xs text-foreground">
            <TriangleAlert size={13} className="mt-px shrink-0" />
            <span>
              They must set a new password the next time they sign in — every
              other page is closed to them until they do.
            </span>
          </p>
        )}

        {status === null && (
          <p className="mt-4 rounded-md bg-surface-secondary px-2.5 py-1.5 text-xs text-muted">
            Whether this account can sign in couldn't be read. The API keeps
            active/disabled as a directory filter rather than a field on the
            record, so both actions are offered above.
          </p>
        )}
      </section>

      {canManage && (
        <StaffDrawer
          state={drawer}
          onClose={() => setDrawer(null)}
          submitting={navigation.state === "submitting"}
          fieldErrors={actionData?.fieldErrors}
          formError={actionData?.formError}
        />
      )}
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd
        className={`mt-0.5 break-words text-sm text-foreground ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
