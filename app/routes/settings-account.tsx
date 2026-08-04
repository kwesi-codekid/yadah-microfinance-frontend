import { data, Form, Link } from "react-router";
import { KeyRound, LogOut, TriangleAlert } from "lucide-react";
import type { Route } from "./+types/settings-account";
import { ROLE_LABELS } from "~/lib/auth-client";
import { requireUser } from "~/lib/session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return data({ user });
}

export default function SettingsAccount({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border-2 border-border bg-surface p-5 dark:bg-canvas">
        <h2 className="mb-4 text-xs font-bold uppercase tracking-wide text-muted">
          Signed in as
        </h2>

        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <Detail label="Name" value={user.name} />
          <Detail label="Role" value={ROLE_LABELS[user.role]} />
          <Detail label="Username" value={user.username} />
          <Detail label="Phone" value={user.phone} />
          {user.email && <Detail label="Email" value={user.email} />}
        </dl>

        <p className="mt-4 text-xs text-muted">
          Your name, phone and role are an administrator's to change — ask one
          if any of it is wrong.
        </p>
      </section>

      {user.mustChangePassword && (
        <p className="flex gap-2 rounded-lg border-2 border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          <TriangleAlert size={14} className="mt-px shrink-0" />
          <span>
            You still need to set a password of your own. Until you do, every
            other page sends you back to do it.
          </span>
        </p>
      )}

      <section className="rounded-lg border-2 border-border bg-surface p-5 dark:bg-canvas">
        <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
          Security
        </h2>
        <p className="mb-4 text-sm text-muted">
          Changing your password signs out every other device, and keeps this
          one.
        </p>

        <div className="flex flex-wrap gap-2">
          <Link
            to="/change-password"
            className="flex min-h-9 items-center gap-1.5 rounded-md bg-success px-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <KeyRound size={14} />
            Change password
          </Link>
          {/* A POST: the GET route only bounces back with the session intact. */}
          <Form method="post" action="/logout">
            <button
              type="submit"
              className="flex min-h-9 items-center gap-1.5 rounded-md border-2 border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-secondary"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </Form>
        </div>
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{value}</dd>
    </div>
  );
}
