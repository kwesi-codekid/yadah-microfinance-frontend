import { data, Form, Link, redirect, useNavigation } from "react-router";
import { Button } from "@heroui/react";
import { KeyRound } from "lucide-react";
import type { Route } from "./+types/change-password";
import { FieldError } from "~/components/form-fields";
import { TextInput } from "~/components/inputs";
import { ThemeToggle } from "~/components/theme-toggle";
import * as authApi from "~/lib/api/auth";
import { ApiError } from "~/lib/api/client";
import { requireUser, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Change password · YADAH Dynamic Enterprise" }];
}

const FIELD_CLASS =
  "min-h-[40px] rounded-md dark:bg-white/5 border-2 border-success/50 focus:ring-0";

/** Only permit same-origin, absolute-path redirects (guards against open redirect). */
function safeRedirect(value: FormDataEntryValue | null, fallback = "/dashboard") {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export async function loader({ request }: Route.LoaderArgs) {
  // Exempt from its own guard — see `requireUser`.
  const user = await requireUser(request);
  const url = new URL(request.url);
  return {
    name: user.name,
    forced: user.mustChangePassword,
    redirectTo: safeRedirect(url.searchParams.get("redirectTo")),
  };
}

type ActionData = {
  formError?: string;
  fieldErrors?: Record<string, string>;
};

export async function action({ request }: Route.ActionArgs) {
  await requireUser(request);
  const form = await request.formData();
  const currentPassword = String(form.get("currentPassword") ?? "");
  const newPassword = String(form.get("newPassword") ?? "");
  const confirmPassword = String(form.get("confirmPassword") ?? "");
  const redirectTo = safeRedirect(form.get("redirectTo"));

  const fieldErrors: Record<string, string> = {};
  if (!currentPassword) {
    fieldErrors.currentPassword = "Enter your current password.";
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    fieldErrors.newPassword = "New password must be 8–128 characters.";
  } else if (newPassword === currentPassword) {
    fieldErrors.newPassword = "Choose a password different from the current one.";
  } else if (newPassword !== confirmPassword) {
    fieldErrors.confirmPassword = "The two passwords don't match.";
  }
  if (Object.keys(fieldErrors).length) return data<ActionData>({ fieldErrors });

  try {
    const { data: result, headers } = await withAuth(
      request,
      async (token, session) => {
        try {
          await authApi.changePassword(token, { currentPassword, newPassword });
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.status === 401 &&
            error.code === "INVALID_CREDENTIALS"
          ) {
            return {
              fieldErrors: { currentPassword: "That isn't your current password." },
            } satisfies ActionData;
          }
          throw error;
        }

        const { user } = await authApi.me(token);
        session.setUser(user);
        return {} satisfies ActionData;
      },
    );

    if (result.fieldErrors) return data<ActionData>(result, { headers });
    return redirect(redirectTo, { headers });
  } catch (error) {
    if (error instanceof Response) throw error; // a session that couldn't renew
    return data<ActionData>({
      formError:
        error instanceof ApiError
          ? error.message
          : "Something went wrong. Please try again.",
    });
  }
}

export default function ChangePassword({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { name, forced, redirectTo } = loaderData;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const fieldErrors = actionData?.fieldErrors;

  return (
    <div className="flex min-h-dvh flex-col bg-background px-6 py-10">
      <div className="mx-auto flex w-full max-w-md justify-end">
        <ThemeToggle />
      </div>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <div className="mb-6">
          <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-success/15 text-success">
            <KeyRound size={20} />
          </span>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            {forced ? "Set a new password" : "Change your password"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {forced
              ? `Your password was reset by an administrator, ${name.split(" ")[0]}. Choose one only you know before carrying on.`
              : "You'll stay signed in here. Any other device you're signed in on will be signed out."}
          </p>
        </div>

        {actionData?.formError && (
          <p
            role="alert"
            className="mb-4 rounded-md border-2 border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
          >
            {actionData.formError}
          </p>
        )}

        <Form method="post" className="space-y-4">
          <input type="hidden" name="redirectTo" value={redirectTo} />

          <div className="space-y-1.5">
            <TextInput
              name="currentPassword"
              label="Current password"
              type="password"
              isRequired
              isInvalid={Boolean(fieldErrors?.currentPassword)}
              inputProps={{
                autoComplete: "current-password",
                className: FIELD_CLASS,
              }}
            />
            <FieldError message={fieldErrors?.currentPassword} />
          </div>

          <div className="space-y-1.5">
            <TextInput
              name="newPassword"
              label="New password"
              type="password"
              isRequired
              isInvalid={Boolean(fieldErrors?.newPassword)}
              inputProps={{
                autoComplete: "new-password",
                className: FIELD_CLASS,
              }}
            />
            <FieldError message={fieldErrors?.newPassword} />
            <p className="text-xs text-muted">At least 8 characters.</p>
          </div>

          <div className="space-y-1.5">
            <TextInput
              name="confirmPassword"
              label="Confirm new password"
              type="password"
              isRequired
              isInvalid={Boolean(fieldErrors?.confirmPassword)}
              inputProps={{
                autoComplete: "new-password",
                className: FIELD_CLASS,
              }}
            />
            <FieldError message={fieldErrors?.confirmPassword} />
          </div>

          <Button
            type="submit"
            variant="primary"
            fullWidth
            className="rounded-md bg-success/90 text-white"
            isDisabled={submitting}
          >
            {submitting ? "Saving…" : "Change password"}
          </Button>
        </Form>

        <p className="mt-6 text-center text-sm text-muted">
          {forced ? (
            <Link to="/logout" className="hover:text-foreground hover:underline">
              Sign out instead
            </Link>
          ) : (
            <Link to={redirectTo} className="hover:text-foreground hover:underline">
              Cancel
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}
