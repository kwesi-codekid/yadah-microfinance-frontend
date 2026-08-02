import { useEffect, useRef, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { Button, InputOTP, REGEXP_ONLY_DIGITS } from "@heroui/react";
import type { Route } from "./+types/verify-otp";
import { AuthShell, AUTH_SUBMIT_CLASS } from "~/components/auth-shell";
import * as authApi from "~/lib/api/auth";
import { ApiError } from "~/lib/api/client";
import {
  cancelOtpVerification,
  createUserSession,
  getOptionalUser,
  getPendingOtp,
} from "~/lib/session.server";
import { validateOtp } from "~/lib/validation";

const CODE_LENGTH = 6;
/** The code is shown as two groups either side of a separator. */
const HALF = CODE_LENGTH / 2;

const SLOT_CLASS =
  "h-14 flex-1 rounded-md border-2 shadow-none [&_.input-otp__slot-value]:text-2xl";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Enter your code · YADAH Dynamic Enterprise" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  // Already signed in → nothing to verify.
  const user = await getOptionalUser(request);
  if (user) throw await cancelOtpVerification(request);

  const pending = await getPendingOtp(request);
  // No code in flight — send them back to ask for one.
  if (!pending) throw await cancelOtpVerification(request);

  return { phone: pending.phone };
}

type ActionData = {
  fieldError?: string;
  formError?: string;
  /** Set after a successful resend, so the page can confirm it. */
  resent?: boolean;
};

export async function action({ request }: Route.ActionArgs) {
  const pending = await getPendingOtp(request);
  // The pending number expired or was cleared in another tab mid-form.
  if (!pending) return cancelOtpVerification(request);

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "cancel") return cancelOtpVerification(request);

  try {
    if (intent === "resend") {
      await authApi.requestOtp({ phone: pending.phone });
      return data<ActionData>({ resent: true });
    }

    const code = String(form.get("code") ?? "").trim();
    const err = validateOtp(code);
    if (err) return data<ActionData>({ fieldError: err }, { status: 400 });

    const { user, tokens } = await authApi.verifyOtp({
      phone: pending.phone,
      code,
    });
    // Mints a fresh cookie, which is also what drops the pending number.
    return createUserSession({ user, tokens, redirectTo: pending.redirectTo });
  } catch (error) {
    return data<ActionData>(mapError(error), { status: 400 });
  }
}

function mapError(error: unknown): ActionData {
  if (error instanceof ApiError) {
    if (error.code === "NETWORK_ERROR") return { formError: error.message };
    if (error.status === 429) {
      return { formError: "Too many attempts. Please wait a moment and try again." };
    }
    if (error.status === 401) {
      return { fieldError: "That code is invalid or has expired." };
    }
    return { formError: error.message };
  }
  return { formError: "Something went wrong. Please try again." };
}

export default function VerifyOtp({ loaderData }: Route.ComponentProps) {
  const { phone } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const busyIntent = navigation.formData?.get("intent");

  const [code, setCode] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const verifyRef = useRef<HTMLButtonElement>(null);

  const invalid = Boolean(actionData?.fieldError);

  useEffect(() => {
    if (actionData?.fieldError) setCode("");
  }, [actionData]);

  useEffect(() => {
    if (code.length !== CODE_LENGTH) return;
    formRef.current?.requestSubmit(verifyRef.current);
  }, [code]);

  return (
    <AuthShell>
      {actionData?.formError && (
        <p
          role="alert"
          className="mb-4 rounded-md border-2 border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
        >
          {actionData.formError}
        </p>
      )}

      <div className="mb-6 space-y-1">
        <h1 className="text-center font-sen text-3xl font-bold">Enter your code</h1>
        <p className="text-center text-muted">
          We sent a {CODE_LENGTH}-digit code to{" "}
          <span className="font-medium text-foreground">{phone}</span>.
        </p>
      </div>

      <Form method="post" replace ref={formRef} className="space-y-5">
        <div className="flex flex-col items-center gap-2">
          <InputOTP
            name="code"
            maxLength={CODE_LENGTH}
            pattern={REGEXP_ONLY_DIGITS}
            value={code}
            onChange={setCode}
            isInvalid={invalid}
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            aria-label="Verification code"
            className="w-full"
            pasteTransformer={(pasted) =>
              pasted.replace(/\D/g, "").slice(0, CODE_LENGTH)
            }
          >
            <InputOTP.Group className="flex-1">
              {Array.from({ length: HALF }, (_, i) => (
                <InputOTP.Slot key={i} index={i} className={SLOT_CLASS} />
              ))}
            </InputOTP.Group>
            <InputOTP.Separator />
            <InputOTP.Group className="flex-1">
              {Array.from({ length: CODE_LENGTH - HALF }, (_, i) => (
                <InputOTP.Slot
                  key={HALF + i}
                  index={HALF + i}
                  className={SLOT_CLASS}
                />
              ))}
            </InputOTP.Group>
          </InputOTP>
          {actionData?.fieldError && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {actionData.fieldError}
            </p>
          )}
          {actionData?.resent && !actionData.fieldError && (
            <p className="text-sm text-success" role="status">
              A new code is on its way.
            </p>
          )}
        </div>

        <Button
          ref={verifyRef}
          type="submit"
          name="intent"
          value="verify"
          variant="primary"
          fullWidth
          className={AUTH_SUBMIT_CLASS}
          isDisabled={submitting}
        >
          {submitting && busyIntent === "verify" ? "Verifying…" : "Verify & sign in"}
        </Button>

        <div className="flex items-center justify-between text-sm">
          <Button
            type="submit"
            name="intent"
            value="resend"
            variant="ghost"
            isDisabled={submitting}
          >
            {submitting && busyIntent === "resend" ? "Sending…" : "Resend code"}
          </Button>
          <Button
            type="submit"
            name="intent"
            value="cancel"
            variant="ghost"
            isDisabled={submitting}
          >
            Use a different number
          </Button>
        </div>
      </Form>
    </AuthShell>
  );
}
