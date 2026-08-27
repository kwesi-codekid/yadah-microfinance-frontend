import { ArrowRightIcon, LockIcon, PhoneIcon, UserIcon } from "lucide-react";
import { useState } from "react";
import { data, Form, Link, redirect, useNavigation, useSearchParams } from "react-router";

import * as authApi from "~/api/auth";
import { describeAuthError } from "~/api/error";
import { AuthField } from "~/components/auth-field";
import { AuthShell, FormError, FormNotice } from "~/components/auth-shell";
import { Button } from "~/components/ui/button";
import { FieldGroup } from "~/components/ui/field";
import { Spinner } from "~/components/ui/spinner";
import { DEFAULT_LANDING } from "~/lib/paths";
import {
  createUserSession,
  getOptionalUser,
  safeRedirect,
  startOtpVerification,
} from "~/lib/session.server";
import { validatePassword, validatePhone, validateUsername } from "~/lib/validation";
import type { Route } from "./+types/login";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Sign in · Yadah Dynamic Enterprise" }];
}

type ActionData = {
  fieldErrors?: Record<string, string>;
  formError?: string;
};

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getOptionalUser(request);
  if (user) {
    const url = new URL(request.url);
    return redirect(safeRedirect(url.searchParams.get("redirectTo")));
  }
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = form.get("intent");
  const redirectTo = safeRedirect(form.get("redirectTo"));

  try {
    if (intent === "password") {
      // Usernames are lowercase by rule, so a stray capital is a typo, not a miss.
      const username = String(form.get("username") ?? "").trim().toLowerCase();
      const password = String(form.get("password") ?? "");

      if (username.includes("@")) {
        return data<ActionData>(
          { fieldErrors: { username: "Use your username, not your email address." } },
          { status: 400 },
        );
      }

      const badUsername = validateUsername(username);
      if (badUsername) {
        return data<ActionData>({ fieldErrors: { username: badUsername } }, { status: 400 });
      }

      const badPassword = validatePassword(password);
      if (badPassword) {
        return data<ActionData>({ fieldErrors: { password: badPassword } }, { status: 400 });
      }

      const { user, tokens } = await authApi.login({ username, password });
      return createUserSession({ user, tokens, redirectTo });
    }

    if (intent === "otp-request") {
      const phone = String(form.get("phone") ?? "").trim();
      const badPhone = validatePhone(phone);
      if (badPhone) {
        return data<ActionData>({ fieldErrors: { phone: badPhone } }, { status: 400 });
      }

      await authApi.requestOtp({ phone });
      return startOtpVerification(request, { phone, redirectTo });
    }

    return data<ActionData>({ formError: "Unsupported request." }, { status: 400 });
  } catch (error) {
    return data<ActionData>({ formError: describeAuthError(error) }, { status: 400 });
  }
}

export default function Login({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const redirectTo = safeRedirectParam(searchParams.get("redirectTo"));

  const [method, setMethod] = useState<"password" | "phone">("password");

  // While a submit is in flight the previous answer is stale — drop it, or the
  // old error sits under the fields the person is already fixing.
  const idle = navigation.state === "idle";
  const fieldErrors = idle ? actionData?.fieldErrors : undefined;
  const formError = idle ? actionData?.formError : undefined;
  const busyIntent = navigation.formData?.get("intent");

  return (
    <AuthShell
      title="Welcome back"
      description={
        method === "password"
          ? "Sign in to your account."
          : "We text a code to the number on your account."
      }
      footer={
        <>
          <p className="text-center text-sm">
            <button
              type="button"
              onClick={() => setMethod(method === "password" ? "phone" : "password")}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {method === "password"
                ? "Sign in with your phone instead"
                : "Sign in with your username instead"}
            </button>
          </p>
          <p className="text-center text-sm">
            <Link
              to="/portal/login"
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Customer? Sign in to your account instead
            </Link>
          </p>
          <p className="text-center text-sm">
            <Link
              to="/forgot-password"
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgot your password?
            </Link>
          </p>
        </>
      }
    >
      {formError && <FormError>{formError}</FormError>}

      {searchParams.get("reason") === "role-changed" && (
        <FormNotice tone="warning">
          Your role was changed. Sign in again to continue.
        </FormNotice>
      )}

      {searchParams.get("reset") === "1" && (
        <FormNotice tone="success">Password set. Sign in with it.</FormNotice>
      )}

      {method === "password" ? (
        <Form method="post" replace>
          <input type="hidden" name="redirectTo" value={redirectTo} />

          <FieldGroup className="gap-5">
            <AuthField
              name="username"
              label="Username"
              icon={UserIcon}
              error={fieldErrors?.username}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
            />
            <AuthField
              name="password"
              label="Password"
              type="password"
              icon={LockIcon}
              error={fieldErrors?.password}
              autoComplete="current-password"
              required
            />

            <SubmitButton
              intent="password"
              busy={!idle && busyIntent === "password"}
              busyLabel="Signing in"
            >
              Sign in
            </SubmitButton>
          </FieldGroup>
        </Form>
      ) : (
        <Form method="post" replace>
          <input type="hidden" name="redirectTo" value={redirectTo} />

          <FieldGroup className="gap-5">
            <AuthField
              name="phone"
              label="Phone number"
              type="tel"
              icon={PhoneIcon}
              error={fieldErrors?.phone}
              hint="A 6-digit code arrives by SMS. It lasts 5 minutes."
              inputMode="numeric"
              autoComplete="tel"
              placeholder="0244123456"
              required
            />

            <SubmitButton
              intent="otp-request"
              busy={!idle && busyIntent === "otp-request"}
              busyLabel="Sending code"
            >
              Send code
            </SubmitButton>
          </FieldGroup>
        </Form>
      )}
    </AuthShell>
  );
}

function SubmitButton({
  intent,
  busy,
  busyLabel,
  children,
}: {
  intent: string;
  busy: boolean;
  busyLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="submit"
      name="intent"
      value={intent}
      size="lg"
      className="w-full"
      disabled={busy}
    >
      {busy ? (
        <>
          <Spinner />
          {busyLabel}
        </>
      ) : (
        <>
          {children}
          <ArrowRightIcon />
        </>
      )}
    </Button>
  );
}

/** The same rule the server applies, so the hidden input cannot carry junk. */
function safeRedirectParam(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_LANDING;
  }
  return value;
}
