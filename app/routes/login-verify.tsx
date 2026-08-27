import { ArrowRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { data, Form, redirect, useNavigation } from "react-router";

import * as authApi from "~/api/auth";
import { describeAuthError } from "~/api/error";
import { AuthShell, FormError, FormNotice } from "~/components/auth-shell";
import { Button } from "~/components/ui/button";
import { FieldError } from "~/components/ui/field";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "~/components/ui/input-otp";
import { Spinner } from "~/components/ui/spinner";
import { LOGIN_PATH } from "~/lib/paths";
import {
  cancelOtpVerification,
  createUserSession,
  getOptionalUser,
  getPendingOtp,
} from "~/lib/session.server";
import { validateOtp } from "~/lib/validation";
import type { Route } from "./+types/login-verify";

/** The API's resend cooldown. The countdown below has to agree with it. */
const RESEND_COOLDOWN_SECONDS = 60;

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

  return { phone: pending.phone };
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
      return data<ActionData>({ resent: true });
    }

    const code = String(form.get("code") ?? "").trim();
    const badCode = validateOtp(code);
    if (badCode) return data<ActionData>({ codeError: badCode }, { status: 400 });

    const { user, tokens } = await authApi.verifyOtp({
      phone: pending.phone,
      code,
    });
    return createUserSession({ user, tokens, redirectTo: pending.redirectTo });
  } catch (error) {
    return data<ActionData>({ formError: describeAuthError(error) }, { status: 400 });
  }
}

export default function LoginVerify({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { phone } = loaderData;
  const navigation = useNavigation();
  const formRef = useRef<HTMLFormElement>(null);
  const [code, setCode] = useState("");
  // `actionData` is a fresh object per response, so every resend restarts it.
  const cooldown = useCooldown(RESEND_COOLDOWN_SECONDS, actionData);

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
      description={`We sent a 6-digit code to ${phone}. It expires in 5 minutes.`}
      footer={
        <Form method="post" replace className="text-center">
          <button
            type="submit"
            name="intent"
            value="cancel"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Use a different number
          </button>
        </Form>
      }
    >
      {idle && actionData?.formError && <FormError>{actionData.formError}</FormError>}
      {idle && actionData?.resent && (
        <FormNotice tone="success">A new code is on its way.</FormNotice>
      )}

      <Form method="post" replace ref={formRef} className="space-y-5">
        <div className="space-y-2">
          <InputOTP
            name="code"
            maxLength={6}
            value={code}
            onChange={setCode}
            autoFocus
            containerClassName="justify-between"
            // Six digits is the whole form: submit rather than make them reach
            // for a button they no longer need.
            onComplete={() => formRef.current?.requestSubmit()}
            disabled={verifying}
          >
            <InputOTPGroup className="gap-2">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <InputOTPSlot
                  key={index}
                  index={index}
                  aria-invalid={idle && actionData?.codeError ? true : undefined}
                  className="size-12 rounded-md border-l text-base tabular"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>

          {idle && actionData?.codeError ? (
            <FieldError>{actionData.codeError}</FieldError>
          ) : null}
        </div>

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

        <p className="text-center text-sm text-muted-foreground">
          {cooldown > 0 ? (
            <span className="tabular">Ask for a new code in {cooldown}s</span>
          ) : (
            <button
              type="submit"
              name="intent"
              value="resend"
              className="font-medium text-primary underline-offset-4 hover:underline"
              disabled={!idle}
            >
              Send a new code
            </button>
          )}
        </p>
      </Form>
    </AuthShell>
  );
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
