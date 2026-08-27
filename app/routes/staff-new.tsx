import { data, useActionData } from "react-router";

import { ApiError } from "~/api/error";
import { createUser } from "~/api/users";
import { StaffForm } from "~/components/staff-form";
import { RouteSheet } from "~/components/route-sheet";
import { checkPassword, checkUsername } from "~/lib/staff";
import { missingRequired, parseStaffForm } from "~/lib/staff-form";
import { requireAdmin, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/staff-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Add staff member · Yadah Dynamic Enterprise" }];
}

/** Creating an account is admin-only — enforced here, not just by hiding it. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const input = parseStaffForm(await request.formData());

  if (missingRequired(input)) {
    return data(
      { error: "Add the name, username, phone, role and a first password." },
      { status: 400 },
    );
  }
  const issue = checkUsername(input.username) ?? checkPassword(input.password);
  if (issue) return data({ error: issue }, { status: 400 });

  let result: { user: { id: string } };
  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ data: result, headers } = await withAuth(request, (token) =>
      createUser(token, input),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status },
      );
    }
    throw error;
  }

  // Straight into the new account's own drawer, over the list it now appears
  // in. The query string rides along so closing it lands back on the same
  // filtered listing the admin started from.
  const { search } = new URL(request.url);
  await redirectWithToast(
    `/staff/${result.user.id}${search}`,
    {
      tone: "success",
      message: `${input.name} can now sign in.`,
      description: "Hand them the password in person — nothing was sent.",
    },
    headers,
  );
}

export default function StaffNew() {
  const actionData = useActionData<typeof action>();
  return (
    <RouteSheet backTo="/staff" title="Add staff member">
      <StaffForm
        mode="create"
        error={actionData?.error}
        details={actionData && "details" in actionData ? actionData.details : undefined}
        cancelTo="/staff"
      />
    </RouteSheet>
  );
}
