import { ArrowRightIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { data, Form, redirect, useNavigation } from "react-router";

import * as authApi from "~/api/auth";
import { describeAuthError } from "~/api/error";
import { AuthShell, FormError, FormNotice } from "~/components/auth-shell";
import { GlassProgress } from "~/components/glassyui/glass-progress";
import { GlassProvider } from "~/components/glassyui/glass-provider";
import { Button } from "~/components/ui/button";
import { FieldError, FieldSeparator } from "~/components/ui/field";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "~/components/ui/input-otp";
import { Separator } from "~/components/ui/separator";
import { Spinner } from "~/components/ui/spinner";
import { LOGIN_PATH } from "~/lib/paths";
import {
  cancelOtpVerification,
  createUserSession,
  getOptionalUser,
  getPendingOtp,
  restartOtpClock,
} from "~/lib/session.server";
import { validateOtp } from "~/lib/validation";
import type { Route } from "./+types/login-verify";

/** The API's resend cooldown. The countdown below has to agree with it. */
const RESEND_COOLDOWN_SECONDS = 60;
/** How long the API keeps a code valid. The bar below drains over this. */
const CODE_LIFETIME_SECONDS = 5 * 60;

export function meta(_: Route.MetaArgs) {
  return [{ title: "Enter your code · Yadah Dynamic Enterprise" }];
}

type ActionData = {
  codeError?: string;
  formError?: string;
  resent?: boolean;
};

export async function loader({ request }: Route.LoaderArgs) {
  if (await getOptionalUser(request)) return redirect("/dashboard");

  const pending = await getPendingOtp(request);
  // Nothing was requested, so there is nothing to verify.
  if (!pending) return redirect(LOGIN_PATH);

  // Seconds rather than a timestamp, so a skewed device clock cannot shift the bar.
  const elapsed = Math.floor((Date.now() - pending.sentAt) / 1000);
  return {
    phone: pending.phone,
    codeSecondsLeft: Math.max(0, CODE_LIFETIME_SECONDS - elapsed),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const pending = await getPendingOtp(request);
  if (!pending) return redirect(LOGIN_PATH);

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "cancel") return cancelOtpVerification(request);

  try {
    if (intent === "resend") {
      await authApi.requestOtp({ phone: pending.phone });
      return data<ActionData>(
        { resent: true },
        { headers: { "Set-Cookie": await restartOtpClock(request) } },
      );
    }

    const code = String(form.get("code") ?? "").trim();
    const badCode = validateOtp(code);
    if (badCode) return data<ActionData>({ codeError: badCode }, { status: 400 });

    const { user, tokens } = await authApi.verifyOtp({
      phone: pending.phone,
      code,
    });
    return createUserSession({
      user,
      tokens,
      redirectTo: pending.redirectTo,
      remember: pending.remember,
    });
  } catch (error) {
    return data<ActionData>({ formError: describeAuthError(error) }, { status: 400 });
  }
}

export default function LoginVerify({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { phone, codeSecondsLeft } = loaderData;
  const { resolvedTheme } = useTheme();
  const navigation = useNavigation();
  const formRef = useRef<HTMLFormElement>(null);
  const [code, setCode] = useState("");
  // `actionData` is a fresh object per response, so every resend restarts it.
  const cooldown = useCooldown(RESEND_COOLDOWN_SECONDS, actionData);
  // Loader data is fresh after every action, so a resend refills the bar.
  const codeLeft = useCooldown(codeSecondsLeft, loaderData);

  const idle = navigation.state === "idle";
  const busyIntent = navigation.formData?.get("intent");
  const verifying = !idle && busyIntent !== "resend" && busyIntent !== "cancel";

  // A wrong code has to be cleared before the next one can be typed.
  useEffect(() => {
    if (actionData?.codeError || actionData?.formError) setCode("");
  }, [actionData]);

  return (
    <AuthShell
      title="Enter your code"
      description={`We sent a 4-digit code to ${phone}.`}
    >
      {idle && actionData?.formError && <FormError>{actionData.formError}</FormError>}
      {idle && actionData?.resent && (
        <FormNotice tone="success">A new code is on its way.</FormNotice>
      )}

      {/* As wide as the four boxes, so the bar and button line up with them. */}
      <Form method="post" replace ref={formRef} className="mx-auto w-fit space-y-6">
        <div className="space-y-2">
          <InputOTP
            name="code"
            maxLength={4}
            value={code}
            onChange={setCode}
            autoFocus
            containerClassName="justify-between"
            // Four digits is the whole form: submit rather than make them reach
            // for a button they no longer need.
            onComplete={() => formRef.current?.requestSubmit()}
            disabled={verifying}
          >
            <InputOTPGroup className="gap-3">
              {[0, 1, 2, 3].map((index) => (
                <InputOTPSlot
                  key={index}
                  index={index}
                  aria-invalid={idle && actionData?.codeError ? true : undefined}
                  className="size-16 rounded-lg border-l border-ring/40 text-2xl tabular ring-3 ring-ring/10"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>

          {idle && actionData?.codeError ? (
            <FieldError>{actionData.codeError}</FieldError>
          ) : null}
        </div>

        <GlassProvider defaultTheme={resolvedTheme === "dark" ? "dark" : "light"}>
          <GlassProgress
            size="sm"
            value={codeLeft}
            max={CODE_LIFETIME_SECONDS}
            label={
              codeLeft > 0 ? (
                <span className="text-xs text-muted-foreground tabular">
                  Code expires in {formatClock(codeLeft)}
                </span>
              ) : (
                <span className="text-xs text-destructive">
                  This code has expired. Send a new one.
                </span>
              )
            }
            // The last minute turns red, so the hurry is visible without reading.
            className={
              codeLeft > 60 ? "[--lg-accent:var(--primary)]" : "[--lg-accent:var(--destructive)]"
            }
          />
        </GlassProvider>

        <Button type="submit" size="lg" className="w-full" disabled={verifying}>
          {verifying ? (
            <>
              <Spinner />
              Checking code
            </>
          ) : (
            <>
              Sign in
              <ArrowRightIcon />
            </>
          )}
        </Button>

        <div className="flex flex-col gap-5 pt-1">
          <FieldSeparator className="my-0">or</FieldSeparator>
          <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
            {/* An expired code has nothing left to protect, so resending opens at once. */}
            {cooldown > 0 && codeLeft > 0 ? (
              <span className="tabular">New code in {cooldown}s</span>
            ) : (
              <button
                type="submit"
                name="intent"
                value="resend"
                form="code-actions"
                className="font-medium text-primary underline-offset-4 hover:underline"
                disabled={!idle}
              >
                Send a new code
              </button>
            )}
            <Separator orientation="vertical" className="h-4" />
            <button
              type="submit"
              name="intent"
              value="cancel"
              form="code-actions"
              className="underline-offset-4 hover:text-foreground hover:underline"
              disabled={!idle}
            >
              Use a different number
            </button>
          </div>
        </div>
      </Form>

      {/* Resend and cancel live outside the code form, so Enter in the boxes still signs in. */}
      <Form id="code-actions" method="post" replace />
    </AuthShell>
  );
}

/** 272 → "4:32". */
function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Counts down from `seconds`, restarting whenever `restartKey` changes. */
function useCooldown(seconds: number, restartKey?: unknown): number {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
    const timer = setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          clearInterval(timer);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds, restartKey]);

  return remaining;
}
