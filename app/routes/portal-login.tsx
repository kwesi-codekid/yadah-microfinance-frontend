import { ArrowRightIcon, PhoneIcon } from "lucide-react";
import { data, Form, Link, redirect, useNavigation, useSearchParams } from "react-router";

import { describeAuthError } from "~/api/error";
import * as portalApi from "~/api/portal";
import { AuthField } from "~/components/auth-field";
import { AuthShell, FormError } from "~/components/auth-shell";
import { Button } from "~/components/ui/button";
import { FieldGroup } from "~/components/ui/field";
import { Spinner } from "~/components/ui/spinner";
import { LOGIN_PATH } from "~/lib/paths";
import {
  getOptionalCustomer,
  safePortalRedirect,
  startPortalOtp,
} from "~/lib/portal-session.server";
import { validatePhone } from "~/lib/validation";
import type { Route } from "./+types/portal-login";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Customer sign in · Yadah Dynamic Enterprise" }];
}

type ActionData = { fieldErrors?: Record<string, string>; formError?: string };

/**
 * The customer's way in: the phone number on their record, and a code. There
 * is no enrolment step and no password — any active customer can sign in on
 * the number the office registered them with.
 */
export async function loader({ request }: Route.LoaderArgs) {
  if (await getOptionalCustomer(request)) {
    const url = new URL(request.url);
    return redirect(safePortalRedirect(url.searchParams.get("redirectTo")));
  }
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const redirectTo = safePortalRedirect(form.get("redirectTo"));
  const phone = String(form.get("phone") ?? "").trim();
  const badPhone = validatePhone(phone);
  if (badPhone) return data<ActionData>({ fieldErrors: { phone: badPhone } }, { status: 400 });

  try {
    // Always 202, registered or not. The next screen must not imply the
    // number is on file — it only says a code was sent *if* it is.
    await portalApi.requestOtp({ phone });
    return startPortalOtp(request, { phone, redirectTo });
  } catch (error) {
    return data<ActionData>({ formError: describeAuthError(error) }, { status: 400 });
  }
}

export default function PortalLogin({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const redirectTo = safeRedirectParam(searchParams.get("redirectTo"));
  const idle = navigation.state === "idle";
  const fieldErrors = idle ? actionData?.fieldErrors : undefined;
  const formError = idle ? actionData?.formError : undefined;

  return (
    <AuthShell
      title="Your account"
      description="Sign in with the phone number you registered with. We text you a code."
      footer={
        <p className="text-center text-sm">
          <Link
            to={LOGIN_PATH}
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Staff? Sign in here instead
          </Link>
        </p>
      }
    >
      {formError && <FormError>{formError}</FormError>}

      <Form method="post" replace>
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <FieldGroup className="gap-5">
          <AuthField
            name="phone"
            label="Phone number"
            type="tel"
            icon={PhoneIcon}
            error={fieldErrors?.phone}
            hint="A 6-digit code arrives by SMS if this number is on our books. It lasts 5 minutes."
            inputMode="numeric"
            autoComplete="tel"
            placeholder="0244123456"
            required
          />
          <Button type="submit" size="lg" className="w-full" disabled={!idle}>
            {!idle ? (
              <>
                <Spinner />
                Sending code
              </>
            ) : (
              <>
                Send code
                <ArrowRightIcon />
              </>
            )}
          </Button>
        </FieldGroup>
      </Form>
    </AuthShell>
  );
}

function safeRedirectParam(value: string | null): string {
  if (!value || !value.startsWith("/portal") || value.startsWith("//")) return "/portal";
  return value;
}
