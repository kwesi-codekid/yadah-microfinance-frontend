import { LockIcon } from "lucide-react";
import { data, Form, useNavigation } from "react-router";

import * as authApi from "~/api/auth";
import { describeAuthError } from "~/api/error";
import { AuthField } from "~/components/auth-field";
import { FormError, FormNotice } from "~/components/auth-shell";
import { Page, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { FieldGroup } from "~/components/ui/field";
import { Spinner } from "~/components/ui/spinner";
import { requireUser, withAuth } from "~/lib/session.server";
import { validatePassword } from "~/lib/validation";
import type { Route } from "./+types/change-password";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Change password · Yadah Dynamic Enterprise" }];
}

/** This page has no rail item of its own, so it names itself for the header. */
export const handle = { title: "Change password" };

type ActionData = {
  fieldErrors?: Record<string, string>;
  formError?: string;
  changed?: boolean;
};

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const currentPassword = String(form.get("currentPassword") ?? "");
  const newPassword = String(form.get("newPassword") ?? "");
  const confirmPassword = String(form.get("confirmPassword") ?? "");

  const fieldErrors: Record<string, string> = {};
  if (!currentPassword) fieldErrors.currentPassword = "Enter your current password.";

  const badPassword = validatePassword(newPassword);
  if (badPassword) fieldErrors.newPassword = badPassword;
  else if (newPassword === currentPassword) {
    fieldErrors.newPassword = "Choose a password you have not used here before.";
  } else if (newPassword !== confirmPassword) {
    fieldErrors.confirmPassword = "Both passwords must match.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return data<ActionData>({ fieldErrors }, { status: 400 });
  }

  try {
    // This session survives; every other one the account has is revoked.
    const { headers } = await withAuth(request, (token) =>
      authApi.changePassword(token, { currentPassword, newPassword }),
    );
    return data<ActionData>({ changed: true }, { headers });
  } catch (error) {
    return data<ActionData>({ formError: describeAuthError(error) }, { status: 400 });
  }
}

export default function ChangePassword({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const idle = navigation.state === "idle";
  const fieldErrors = idle ? actionData?.fieldErrors : undefined;

  return (
    <Page contentClassName="max-w-lg">
      <PageHeader
        title="Change password"
        description="Changing it here signs you out of every other device."
      />

      {idle && actionData?.formError && <FormError>{actionData.formError}</FormError>}
      {idle && actionData?.changed && (
        <FormNotice tone="success">
          Password changed. Other devices will need the new one.
        </FormNotice>
      )}

      <Form method="post" replace key={actionData?.changed ? "done" : "editing"}>
        <FieldGroup className="gap-5">
          <AuthField
            name="currentPassword"
            label="Current password"
            type="password"
            icon={LockIcon}
            error={fieldErrors?.currentPassword}
            autoComplete="current-password"
            required
          />
          <AuthField
            name="newPassword"
            label="New password"
            type="password"
            icon={LockIcon}
            error={fieldErrors?.newPassword}
            hint="At least 8 characters."
            autoComplete="new-password"
            required
          />
          <AuthField
            name="confirmPassword"
            label="Confirm new password"
            type="password"
            icon={LockIcon}
            error={fieldErrors?.confirmPassword}
            autoComplete="new-password"
            required
          />

          <div>
            <Button type="submit" size="lg" disabled={!idle}>
              {idle ? (
                "Change password"
              ) : (
                <>
                  <Spinner />
                  Changing password
                </>
              )}
            </Button>
          </div>
        </FieldGroup>
      </Form>
    </Page>
  );
}
