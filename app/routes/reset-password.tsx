import { ArrowRightIcon, LockIcon } from "lucide-react";
import { data, Form, redirect, useNavigation } from "react-router";

import * as authApi from "~/api/auth";
import { describeAuthError } from "~/api/error";
import { AuthField } from "~/components/auth-field";
import { AuthShell, FormError } from "~/components/auth-shell";
import { Button } from "~/components/ui/button";
import { FieldGroup } from "~/components/ui/field";
import { Spinner } from "~/components/ui/spinner";
import { FORGOT_PASSWORD_PATH, LOGIN_PATH } from "~/lib/paths";
import {
  endPasswordReset,
  getOptionalUser,
  getPendingReset,
} from "~/lib/session.server";
import { validateOtp, validatePassword } from "~/lib/validation";
import type { Route } from "./+types/reset-password";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Set a new password · Yadah Dynamic Enterprise" }];
}

type ActionData = {
  fieldErrors?: Record<string, string>;
  formError?: string;
};

export async function loader({ request }: Route.LoaderArgs) {
  if (await getOptionalUser(request)) return redirect("/dashboard");

  const phone = await getPendingReset(request);
  if (!phone) return redirect(FORGOT_PASSWORD_PATH);
  return { phone };
}

export async function action({ request }: Route.ActionArgs) {
  const phone = await getPendingReset(request);
  if (!phone) return redirect(FORGOT_PASSWORD_PATH);

  const form = await request.formData();
  const code = String(form.get("code") ?? "").trim();
  const newPassword = String(form.get("newPassword") ?? "");
  const confirmPassword = String(form.get("confirmPassword") ?? "");

  const fieldErrors: Record<string, string> = {};
  const badCode = validateOtp(code);
  if (badCode) fieldErrors.code = badCode;

  const badPassword = validatePassword(newPassword);
  if (badPassword) fieldErrors.newPassword = badPassword;
  else if (newPassword !== confirmPassword) {
    fieldErrors.confirmPassword = "Both passwords must match.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return data<ActionData>({ fieldErrors }, { status: 400 });
  }

  try {
    await authApi.resetPassword({ phone, code, newPassword });
  } catch (error) {
    return data<ActionData>({ formError: describeAuthError(error) }, { status: 400 });
  }

  // The reset revoked every session, this one included, so it ends at sign-in.
  return endPasswordReset(request, `${LOGIN_PATH}?reset=1`);
}

export default function ResetPassword({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const idle = navigation.state === "idle";
  const fieldErrors = idle ? actionData?.fieldErrors : undefined;

  return (
    <AuthShell
      title="Set a new password"
      description={`Enter the code we sent to ${loaderData.phone} and choose a new password.`}
      footer={
        <p className="text-center text-sm text-muted-foreground">
          Setting a new password signs you out everywhere else.
        </p>
      }
    >
      {idle && actionData?.formError && <FormError>{actionData.formError}</FormError>}

      <Form method="post" replace>
        <FieldGroup className="gap-5">
          <AuthField
            name="code"
            label="Code"
            icon={LockIcon}
            error={fieldErrors?.code}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            className="tabular tracking-[0.3em]"
            autoFocus
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

          <Button type="submit" size="lg" className="w-full" disabled={!idle}>
            {idle ? (
              <>
                Set password
                <ArrowRightIcon />
              </>
            ) : (
              <>
                <Spinner />
                Setting password
              </>
            )}
          </Button>
        </FieldGroup>
      </Form>
    </AuthShell>
  );
}
