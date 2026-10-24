import * as TabsPrimitive from "@radix-ui/react-tabs";
import { ArrowRightIcon, LockIcon, PhoneIcon, UserIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { data, Form, Link, redirect, useNavigation, useSearchParams } from "react-router";

import * as authApi from "~/api/auth";
import { describeAuthError } from "~/api/error";
import { AuthField } from "~/components/auth-field";
import { AuthShell, FormError, FormNotice } from "~/components/auth-shell";
import { GlassProvider } from "~/components/glassyui/glass-provider";
import { GlassTabs, GlassTabsList, GlassTabsTrigger } from "~/components/glassyui/glass-tabs";
import { Button } from "~/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldSeparator } from "~/components/ui/field";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
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

type Method = "password" | "phone";

/** Both sign-in panels in one grid cell; the hidden one still holds its space. */
const STACKED_PANEL = "col-start-1 row-start-1 data-[state=inactive]:invisible";

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
  const remember = form.get("remember") === "on";

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
      return createUserSession({ user, tokens, redirectTo, remember });
    }

    if (intent === "otp-request") {
      const phone = String(form.get("phone") ?? "").trim();
      const badPhone = validatePhone(phone);
      if (badPhone) {
        return data<ActionData>({ fieldErrors: { phone: badPhone } }, { status: 400 });
      }

      await authApi.requestOtp({ phone });
      return startOtpVerification(request, { phone, redirectTo, remember });
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
  const { resolvedTheme } = useTheme();

  const [method, setMethod] = useState<Method>("password");

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
        <div className="flex flex-col gap-5 pt-2">
          <FieldSeparator className="my-0">or</FieldSeparator>
          <p className="text-center text-sm">
            <Link
              to="/portal/login"
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Customer? Sign in to your account instead
            </Link>
          </p>
        </div>
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

      {/* The glass follows the app's theme toggle, not the system setting. */}
      <GlassProvider defaultTheme={resolvedTheme === "dark" ? "dark" : "light"}>
        <GlassTabs value={method} onValueChange={(value) => setMethod(value as Method)}>
          {/* A thicker, brighter rim than the library default reads as glass on a flat page. */}
          <GlassTabsList className="mb-7 [--lg-rim-width:2px] [--lg-rim-width-scale:2] [--lg-specular-counter:0.75] [--lg-specular-floor:0.45] [--lg-specular-peak:1] [&>.lg-tabs-indicator]:after:hidden [&_[data-state=active]]:after:hidden [&_[role=tab]]:outline-none">
            <GlassTabsTrigger value="password">
              <UserIcon className="mr-1.5 size-4" />
              Username
            </GlassTabsTrigger>
            <GlassTabsTrigger value="phone">
              <PhoneIcon className="mr-1.5 size-4" />
              Phone
            </GlassTabsTrigger>
          </GlassTabsList>

          {/* Both forms share one grid cell, so the taller one sets the height and
             switching never moves the tabs. */}
          <div className="grid">
            <TabsPrimitive.Content value="password" forceMount className={STACKED_PANEL}>
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
                    labelAction={
                      <Link
                        to="/forgot-password"
                        className="text-xs text-destructive underline-offset-4 hover:underline"
                      >
                        Forgot password?
                      </Link>
                    }
                    autoComplete="current-password"
                    required
                  />

                  <RememberMe id="remember-password" />

                  <SubmitButton
                    intent="password"
                    busy={!idle && busyIntent === "password"}
                    busyLabel="Signing in"
                  >
                    Sign in
                  </SubmitButton>
                </FieldGroup>
              </Form>
            </TabsPrimitive.Content>

            <TabsPrimitive.Content value="phone" forceMount className={STACKED_PANEL}>
              <Form method="post" replace>
                <input type="hidden" name="redirectTo" value={redirectTo} />

                <FieldGroup className="gap-5">
                  <AuthField
                    name="phone"
                    label="Phone number"
                    type="tel"
                    icon={PhoneIcon}
                    error={fieldErrors?.phone}
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="0244123456"
                    required
                  />

                  <RememberMe id="remember-phone" />

                  <SubmitButton
                    intent="otp-request"
                    busy={!idle && busyIntent === "otp-request"}
                    busyLabel="Sending code"
                  >
                    Send code
                  </SubmitButton>
                </FieldGroup>
              </Form>
            </TabsPrimitive.Content>
          </div>
        </GlassTabs>
      </GlassProvider>
    </AuthShell>
  );
}

/**
 * Off by default: a shared office computer should sign out on its own. On, the
 * session survives until 30 days pass without use.
 */
function RememberMe({ id }: { id: string }) {
  return (
    <Field orientation="horizontal" className="justify-between">
      <FieldLabel htmlFor={id} className="font-normal text-muted-foreground">
        Keep me signed in
      </FieldLabel>
      <Switch id={id} name="remember" />
    </Field>
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
