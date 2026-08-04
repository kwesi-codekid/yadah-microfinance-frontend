import { useEffect, useRef, useState } from "react";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import { Button, InputOTP, REGEXP_ONLY_DIGITS } from "@heroui/react";
import type { Route } from "./+types/forgot-password";
import { AuthShell, AUTH_FIELD_CLASS, AUTH_SUBMIT_CLASS } from "~/components/auth-shell";
import { TextInput } from "~/components/inputs";
import * as authApi from "~/lib/api/auth";
import { ApiError } from "~/lib/api/client";
import { getOptionalUser } from "~/lib/session.server";
import { validateOtp, validatePassword, validatePhone } from "~/lib/validation";

const CODE_LENGTH = 6;
const HALF = CODE_LENGTH / 2;

const SLOT_CLASS =
  "h-14 flex-1 rounded-md border-2 shadow-none [&_.input-otp__slot-value]:text-2xl";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Reset your password · YADAH Dynamic Enterprise" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  // Signed in already — /change-password is the route for that.
  const user = await getOptionalUser(request);
  if (user) throw redirect("/change-password");
  return null;
}

type ActionData = {
  /** The number a code was sent to; its presence is what advances the step. */
  phone?: string;
  resent?: boolean;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const phone = String(form.get("phone") ?? "").trim();

  const phoneError = validatePhone(phone);
  if (phoneError)
    return data<ActionData>({ fieldErrors: { phone: phoneError } });

  try {
    if (intent === "request" || intent === "resend") {
      await authApi.forgotPassword({ phone });
      // A 200 says nothing about whether that number has an account, by design.
      return data<ActionData>({ phone, resent: intent === "resend" });
    }

    const code = String(form.get("code") ?? "").trim();
    const newPassword = String(form.get("newPassword") ?? "");

    const fieldErrors: Record<string, string> = {};
    const codeError = validateOtp(code);
    if (codeError) fieldErrors.code = codeError;
    const passwordError = validatePassword(newPassword);
    if (passwordError) fieldErrors.newPassword = passwordError;
    if (Object.keys(fieldErrors).length)
      return data<ActionData>({ phone, fieldErrors });

    await authApi.resetPassword({ phone, code, newPassword });
    // Every session is revoked by the reset, so there is nothing to carry over.
    return redirect("/login?reset=1");
  } catch (error) {
    if (error instanceof Response) throw error;
    return data<ActionData>({ phone, ...mapError(error) });
  }
}

function mapError(error: unknown): Omit<ActionData, "phone"> {
  if (error instanceof ApiError) {
    if (error.code === "NETWORK_ERROR") return { formError: error.message };
    if (error.status === 429)
      return {
        formError: "Too many requests. Please wait a moment and try again.",
      };
    if (error.status === 401)
      return { fieldErrors: { code: "That code is invalid or has expired." } };
    return { formError: error.message };
  }
  return { formError: "Something went wrong. Please try again." };
}

export default function ForgotPassword({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const busyIntent = navigation.formData?.get("intent");
  const sentTo = actionData?.phone;

  const [code, setCode] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (actionData?.fieldErrors?.code) setCode("");
  }, [actionData]);

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
        <h1 className="text-center font-sen text-3xl font-bold">
          {sentTo ? "Set a new password" : "Reset your password"}
        </h1>
        <p className="text-center text-muted">
          {sentTo ? (
            <>
              If <span className="font-medium text-foreground">{sentTo}</span>{" "}
              has an account, a {CODE_LENGTH}-digit code is on its way to it.
            </>
          ) : (
            "Give us the phone number on your account and we'll text you a code."
          )}
        </p>
      </div>

      {!sentTo ? (
        <Form method="post" className="space-y-5" replace>
          <div className="space-y-1.5">
            <TextInput
              name="phone"
              label="Phone number"
              type="tel"
              isRequired
              isInvalid={Boolean(actionData?.fieldErrors?.phone)}
              inputProps={{
                inputMode: "numeric",
                autoComplete: "tel",
                placeholder: "0241234567",
                className: AUTH_FIELD_CLASS,
              }}
            />
            <FieldError message={actionData?.fieldErrors?.phone} />
          </div>

          <Button
            type="submit"
            name="intent"
            value="request"
            variant="primary"
            fullWidth
            className={AUTH_SUBMIT_CLASS}
            isDisabled={submitting}
          >
            {submitting ? "Sending code…" : "Send code"}
          </Button>
        </Form>
      ) : (
        <Form method="post" className="space-y-5" replace ref={formRef}>
          <input type="hidden" name="phone" value={sentTo} />

          <div className="flex flex-col items-center gap-2">
            <InputOTP
              name="code"
              maxLength={CODE_LENGTH}
              pattern={REGEXP_ONLY_DIGITS}
              value={code}
              onChange={setCode}
              isInvalid={Boolean(actionData?.fieldErrors?.code)}
              autoFocus
              autoComplete="one-time-code"
              inputMode="numeric"
              aria-label="Reset code"
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
            <FieldError message={actionData?.fieldErrors?.code} />
            {actionData?.resent && !actionData.fieldErrors && (
              <p className="text-sm text-success" role="status">
                A new code is on its way.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <TextInput
              name="newPassword"
              label="New password"
              type="password"
              isRequired
              isInvalid={Boolean(actionData?.fieldErrors?.newPassword)}
              inputProps={{
                autoComplete: "new-password",
                className: AUTH_FIELD_CLASS,
              }}
            />
            <FieldError message={actionData?.fieldErrors?.newPassword} />
            <p className="text-xs text-muted">
              8–128 characters. Setting it signs you out everywhere else.
            </p>
          </div>

          <Button
            type="submit"
            name="intent"
            value="reset"
            variant="primary"
            fullWidth
            className={AUTH_SUBMIT_CLASS}
            isDisabled={submitting}
          >
            {submitting && busyIntent === "reset"
              ? "Setting password…"
              : "Set password and sign in"}
          </Button>

          <Button
            type="submit"
            name="intent"
            value="resend"
            variant="ghost"
            fullWidth
            isDisabled={submitting}
          >
            {submitting && busyIntent === "resend"
              ? "Sending…"
              : "Send another code"}
          </Button>
        </Form>
      )}

      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="font-medium text-success">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
      {message}
    </p>
  );
}
