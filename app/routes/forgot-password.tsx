import { ArrowRightIcon, PhoneIcon } from "lucide-react";
import { data, Form, Link, redirect, useNavigation } from "react-router";

import * as authApi from "~/api/auth";
import { describeAuthError } from "~/api/error";
import { AuthField } from "~/components/auth-field";
import { AuthShell, FormError } from "~/components/auth-shell";
import { Button } from "~/components/ui/button";
import { FieldGroup } from "~/components/ui/field";
import { Spinner } from "~/components/ui/spinner";
import { LOGIN_PATH } from "~/lib/paths";
import { getOptionalUser, startPasswordReset } from "~/lib/session.server";
import { validatePhone } from "~/lib/validation";
import type { Route } from "./+types/forgot-password";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Reset your password · Yadah Dynamic Enterprise" }];
}

type ActionData = { phoneError?: string; formError?: string };

export async function loader({ request }: Route.LoaderArgs) {
  if (await getOptionalUser(request)) return redirect("/dashboard");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const phone = String(form.get("phone") ?? "").trim();

  const badPhone = validatePhone(phone);
  if (badPhone) return data<ActionData>({ phoneError: badPhone }, { status: 400 });

  try {
    await authApi.forgotPassword({ phone });
  } catch (error) {
    return data<ActionData>({ formError: describeAuthError(error) }, { status: 400 });
  }

  // The API answers the same way whether or not the number is registered, and
  // so does this screen — moving on either way is what keeps that true.
  return startPasswordReset(request, phone);
}

export default function ForgotPassword({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const idle = navigation.state === "idle";

  return (
    <AuthShell
      title="Reset your password"
      description="Give us the phone number on your account and we will text you a code."
      footer={
        <p className="text-center text-sm">
          <Link
            to={LOGIN_PATH}
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      }
    >
      {idle && actionData?.formError && <FormError>{actionData.formError}</FormError>}

      <Form method="post" replace>
        <FieldGroup className="gap-5">
          <AuthField
            name="phone"
            label="Phone number"
            type="tel"
            icon={PhoneIcon}
            error={idle ? actionData?.phoneError : undefined}
            inputMode="numeric"
            autoComplete="tel"
            placeholder="0244123456"
            autoFocus
            required
          />

          <Button type="submit" size="lg" className="w-full" disabled={!idle}>
            {idle ? (
              <>
                Send code
                <ArrowRightIcon />
              </>
            ) : (
              <>
                <Spinner />
                Sending code
              </>
            )}
          </Button>
        </FieldGroup>
      </Form>
    </AuthShell>
  );
}
