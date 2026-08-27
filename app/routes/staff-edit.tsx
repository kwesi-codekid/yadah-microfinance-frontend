import { data, useActionData } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { getUser, updateUser } from "~/api/users";
import { StaffForm } from "~/components/staff-form";
import { RouteSheet } from "~/components/route-sheet";
import { diffStaff, parseStaffForm } from "~/lib/staff-form";
import { requireAdmin, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/staff-edit";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.staff.name ?? "Staff";
  return [{ title: `Edit ${name} · Yadah Dynamic Enterprise` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const admin = await requireAdmin(request);
  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      return await getUser(token, params.id);
    } catch (error) {
      throwAsRouteError(error);
    }
  });
  return data(
    { staff: result.user, isSelf: result.user.id === admin.id },
    { headers },
  );
}

/**
 * `PATCH /users/:id`, with only the fields that moved. The role is the one that
 * costs something: changing it revokes every session that user is holding, so
 * resending an unchanged role would sign someone out for nothing.
 */
export async function action({ request, params }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  const input = parseStaffForm(await request.formData());

  if (!input.name || !input.phone) {
    return data({ error: "The name and the phone number are required." }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, async (token) => {
      const { user } = await getUser(token, params.id);
      const patch = diffStaff(user, input);
      // The API refuses this with CANNOT_MODIFY_SELF; catching it here names
      // the field rather than failing the whole save.
      if (patch.role && user.id === admin.id) {
        return {
          blocked: "You cannot change your own role." as const,
          roleMoved: false,
        };
      }
      if (Object.keys(patch).length === 0) {
        return { blocked: "Nothing was changed." as const, roleMoved: false };
      }
      await updateUser(token, params.id, patch);
      return { blocked: null, roleMoved: patch.role !== undefined };
    });

    if (result.blocked) {
      return data({ error: result.blocked }, { status: 400 });
    }
    // Back to the account's own drawer, filters intact.
    const { search } = new URL(request.url);
    await redirectWithToast(
      `/staff/${params.id}${search}`,
      {
        tone: "success",
        message: "Changes saved.",
        description: result.roleMoved
          ? "The role changed, so every session they held is closed."
          : undefined,
      },
      headers,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status },
      );
    }
    throw error;
  }
}

export default function StaffEdit({ loaderData }: Route.ComponentProps) {
  const { staff, isSelf } = loaderData;
  const actionData = useActionData<typeof action>();

  return (
    <RouteSheet backTo="/staff" title={`Edit ${staff.name}`} description={`@${staff.username}`}>
      <StaffForm
        mode="edit"
        staff={staff}
        isSelf={isSelf}
        error={actionData?.error}
        details={actionData && "details" in actionData ? actionData.details : undefined}
        cancelTo={`/staff/${staff.id}`}
      />
    </RouteSheet>
  );
}
