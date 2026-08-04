import { useState } from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  useSearchParams,
} from "react-router";
import type { Route } from "./+types/login";
import { AuthShell, AUTH_FIELD_CLASS, AUTH_SUBMIT_CLASS } from "~/components/auth-shell";
import { TextInput } from "~/components/inputs";
import { ApiError } from "~/lib/api/client";
import * as authApi from "~/lib/api/auth";
import {
  createUserSession,
  getOptionalUser,
  safeRedirect,
  startOtpVerification,
} from "~/lib/session.server";
import { validatePassword, validatePhone, validateUsername } from "~/lib/validation";
import { Button } from "@heroui/react";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Sign in · YADAH Dynamic Enterprise" }];
}

type ActionData = {
  fieldErrors?: Record<string, string>;
  formError?: string;
};

export async function loader({ request }: Route.LoaderArgs) {
  // Already signed in → skip the login page.
  const user = await getOptionalUser(request);
  if (user) {
    const url = new URL(request.url);
    return redirect(safeRedirect(url.searchParams.get("redirectTo"), "/dashboard"));
  }
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = form.get("intent");
  const redirectTo = safeRedirect(form.get("redirectTo"), "/dashboard");

  try {
    if (intent === "password") {
      // Usernames are lowercase by rule, so a stray capital is a typo, not a miss.
      const username = String(form.get("username") ?? "")
        .trim()
        .toLowerCase();
      const password = String(form.get("password") ?? "");

      if (username.includes("@")) {
        return data<ActionData>(
          {
            fieldErrors: {
              username: "Sign in with your username, not your email address.",
            },
          },
          { status: 400 },
        );
      }

      const u = validateUsername(username);
      if (u) return data<ActionData>({ fieldErrors: { username: u } }, { status: 400 });

      const p = validatePassword(password);
      if (p) return data<ActionData>({ fieldErrors: { password: p } }, { status: 400 });

      const { user, tokens } = await authApi.login({ username, password });
      return createUserSession({ user, tokens, redirectTo });
    }

    if (intent === "otp-request") {
      const phone = String(form.get("phone") ?? "").trim();
      const err = validatePhone(phone);
      if (err) {
        return data<ActionData>({ fieldErrors: { phone: err } }, { status: 400 });
      }
      await authApi.requestOtp({ phone });
      return startOtpVerification(request, { phone, redirectTo });
    }

    return data<ActionData>({ formError: "Unsupported request." }, { status: 400 });
  } catch (error) {
    return data<ActionData>(mapAuthError(intent, error), { status: 400 });
  }
}

/** Translate an ApiError into a user-facing message per the endpoint contract. */
function mapAuthError(intent: FormDataEntryValue | null, error: unknown): ActionData {
  if (error instanceof ApiError) {
    if (error.code === "NETWORK_ERROR") return { formError: error.message };
    if (error.status === 429) {
      return { formError: "Too many attempts. Please wait a moment and try again." };
    }
    if (error.status === 401 && intent === "password") {
      // The pair is wrong, not the username — pinning it to one field misleads.
      return { formError: "Incorrect username or password." };
    }
    return { formError: error.message };
  }
  return { formError: "Something went wrong. Please try again." };
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/dashboard";

  const [tab, setTab] = useState<"password" | "phone">("password");

  const fieldErrors = navigation.state === "idle" ? actionData?.fieldErrors : undefined;
  const formError = navigation.state === "idle" ? actionData?.formError : undefined;

  const submitting = navigation.state === "submitting";
  const busyIntent = navigation.formData?.get("intent");

  return (
    <AuthShell>
      {formError && (
        <p
          role="alert"
          className="mb-4 rounded-md border-2 border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
        >
          {formError}
        </p>
      )}

      {/* `?reset=1` is the handoff from /forgot-password. */}
      {searchParams.get("reset") === "1" && (
        <p
          role="status"
          className="mb-4 rounded-md border-2 border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
        >
          Password set. Sign in with it.
        </p>
      )}

      <div className="mb-6 space-y-1">
        <h1 className="text-center font-sen text-3xl font-bold">Welcome Back!</h1>
        <p className="text-center text-muted">Sign in securely to your account</p>
      </div>

      {/* Auth method is chosen via the switch link below (no tabs). */}
      {tab === "password" ? (
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="redirectTo" value={redirectTo} />

          <div className="space-y-1.5">
            <TextInput
              name="username"
              label="Username"
              isRequired
              isInvalid={Boolean(fieldErrors?.username)}
              startContent={<UserIcon className="size-4" />}
              inputProps={{
                autoComplete: "username",
                autoCapitalize: "none",
                className: AUTH_FIELD_CLASS,
              }}
            />
            <FieldError message={fieldErrors?.username} />
          </div>

          <div className="space-y-1.5">
            <TextInput
              name="password"
              label="Password"
              type="password"
              isRequired
              isInvalid={Boolean(fieldErrors?.password)}
              startContent={<LockIcon className="size-4" />}
              inputProps={{
                autoComplete: "current-password",
                className: AUTH_FIELD_CLASS,
              }}
            />
            <FieldError message={fieldErrors?.password} />
          </div>

          <Button
            type="submit"
            name="intent"
            value="password"
            variant="primary"
            fullWidth
            className={AUTH_SUBMIT_CLASS}
            isDisabled={submitting}
          >
            {submitting && busyIntent === "password" ? (
              "Signing in…"
            ) : (
              <>
                Sign in
                <ArrowRightIcon className="size-4" />
              </>
            )}
          </Button>
        </Form>
      ) : (
        /* Phone: request a code, then hand off to /login/verify. */
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="redirectTo" value={redirectTo} />

          <div className="space-y-1.5">
            <TextInput
              name="phone"
              label="Phone number"
              type="tel"
              isRequired
              isInvalid={Boolean(fieldErrors?.phone)}
              startContent={<PhoneIcon className="size-4" />}
              inputProps={{
                inputMode: "numeric",
                autoComplete: "tel",
                className: AUTH_FIELD_CLASS,
              }}
            />
            <FieldError message={fieldErrors?.phone} />
            <p className="text-xs text-muted">
              We'll text you a 6-digit code to sign in with.
            </p>
          </div>

          <Button
            type="submit"
            name="intent"
            value="otp-request"
            variant="primary"
            fullWidth
            className={AUTH_SUBMIT_CLASS}
            isDisabled={submitting}
          >
            {submitting && busyIntent === "otp-request" ? (
              "Sending code…"
            ) : (
              <>
                Send code
                <ArrowRightIcon className="size-4" />
              </>
            )}
          </Button>
        </Form>
      )}

      <p className="mt-6 text-center text-sm">
        <button
          type="button"
          onClick={() => setTab(tab === "password" ? "phone" : "password")}
          className="font-medium text-success dark:text-success"
        >
          {tab === "password"
            ? "Login with phone"
            : "Login with username and password"}
        </button>
      </p>

      <p className="mt-2 text-center text-sm">
        <Link to="/forgot-password" className="text-muted hover:text-foreground">
          Forgot your password?
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

/* --- Inline icons (stroke, inherit currentColor) --- */

type IconProps = { className?: string };

function iconBase(className?: string) {
  return {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

function ArrowRightIcon({ className }: IconProps) {
  return (
    <svg {...iconBase(className)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function UserIcon({ className }: IconProps) {
  return (
    <svg {...iconBase(className)}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LockIcon({ className }: IconProps) {
  return (
    <svg {...iconBase(className)}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function PhoneIcon({ className }: IconProps) {
  return (
    <svg {...iconBase(className)}>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}
