import { useEffect, useLayoutEffect, useState } from "react";
import {
  data,
  Form,
  redirect,
  useActionData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import type { Route } from "./+types/login";
import { TextInput } from "~/components/inputs";
import { ThemeToggle } from "~/components/theme-toggle";
import { ApiError } from "~/lib/api/client";
import * as authApi from "~/lib/api/auth";
import { createUserSession, getOptionalUser } from "~/lib/session.server";
import {
  validateOtp,
  validatePassword,
  validatePhone,
  validateUsername,
} from "~/lib/validation";
import { Button } from "@heroui/react";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Sign in · YADAH Dynamic Enterprise" }];
}

// useLayoutEffect on the client (runs before paint, so the entrance never
// flashes), useEffect on the server (avoids the SSR warning).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Reference look: full-width, softly filled pill fields. Layered on top of
// TextInput's own bordered treatment so every field reads identically. The
// soft fill is theme-aware, and the focus overrides keep the border neutral
// (not brand-green) and drop HeroUI's blue focus ring.
const FIELD_CLASS =
  "min-h-[40px] rounded-md dark:bg-white/5 border-2 border-success/50 focus:ring-0";

// Green submit actions. HeroUI v3 has no `success` button variant — the set is
// primary / secondary / tertiary / ghost / outline / danger / danger-soft — so
// `variant="success"` emitted a `button--success` class with no rule behind it
// and these buttons rendered unfilled. They use the real `primary` variant for
// its sizing, focus and disabled behaviour, with the fill repainted from the
// `--success` token (#1f8a41) so retuning that token moves the button too.
// `--focus` is pinned as well: HeroUI derives it from `--accent` at `:root`, so
// without this the ring would come back orange under a green button.
const SUBMIT_CLASS =
  "rounded-md bg-success/90 text-white";

// Login backdrop photo. Declared once and used by both breakpoints — the mobile
// full-bleed layer and the desktop left column — so they can't drift apart.
const LOGIN_BG = "url('/money.jpg')";

// Company mark. Same file the splash screen uses, so the two entry points to
// the app open on the same logo.
const LOGO_SRC = "/favicon.png";

/** Only permit same-origin, absolute-path redirects (guards against open redirect). */
function safeRedirect(value: FormDataEntryValue | null, fallback = "/") {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

type ActionData = {
  fieldErrors?: Record<string, string>;
  formError?: string;
  /** Present once an OTP has been requested, so the UI shows the code step. */
  otp?: { phase: "verify"; phone: string };
  message?: string;
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
  const phone = String(form.get("phone") ?? "").trim();

  try {
    if (intent === "password") {
      const username = String(form.get("username") ?? "").trim();
      const password = String(form.get("password") ?? "");

      // One problem at a time, top-down: the username has to be right before a
      // password error is worth showing. Flagging both at once makes the user
      // fix two things at once and re-read the whole form to find out which.
      const u = validateUsername(username);
      if (u) return data<ActionData>({ fieldErrors: { username: u } }, { status: 400 });

      const p = validatePassword(password);
      if (p) return data<ActionData>({ fieldErrors: { password: p } }, { status: 400 });

      const { user, tokens } = await authApi.login({ username, password });
      return createUserSession({ user, tokens, redirectTo });
    }

    if (intent === "otp-request") {
      const err = validatePhone(phone);
      if (err) {
        return data<ActionData>({ fieldErrors: { phone: err } }, { status: 400 });
      }
      const { message } = await authApi.requestOtp({ phone });
      return data<ActionData>({ otp: { phase: "verify", phone }, message });
    }

    if (intent === "otp-verify") {
      const code = String(form.get("code") ?? "").trim();
      const keep = { phase: "verify" as const, phone };

      // Same top-down rule as the password form: phone before code.
      const pe = validatePhone(phone);
      if (pe) {
        return data<ActionData>(
          { otp: keep, fieldErrors: { phone: pe } },
          { status: 400 },
        );
      }

      const ce = validateOtp(code);
      if (ce) {
        return data<ActionData>(
          { otp: keep, fieldErrors: { code: ce } },
          { status: 400 },
        );
      }
      const { user, tokens } = await authApi.verifyOtp({ phone, code });
      return createUserSession({ user, tokens, redirectTo });
    }

    return data<ActionData>({ formError: "Unsupported request." }, { status: 400 });
  } catch (error) {
    return data<ActionData>(mapAuthError(intent, error, phone), { status: 400 });
  }
}

/** Translate an ApiError into a user-facing message per the endpoint contract. */
function mapAuthError(
  intent: FormDataEntryValue | null,
  error: unknown,
  phone: string,
): ActionData {
  // Keep the OTP verify step on screen so the user can retry the code.
  const keepOtp: ActionData["otp"] =
    intent === "otp-verify" ? { phase: "verify", phone } : undefined;

  if (error instanceof ApiError) {
    if (error.code === "NETWORK_ERROR") return { formError: error.message, otp: keepOtp };
    if (error.status === 429) {
      return {
        formError: "Too many attempts. Please wait a moment and try again.",
        otp: keepOtp,
      };
    }
    // A rejected credential belongs under a field, not in the form-level alert,
    // and it goes on the first one so the eye lands on it straight away.
    //
    // It cannot say *which* half was wrong: `POST /auth/login` answers a bad
    // username and a bad password with the same bare 401 — no code, no field —
    // and that is deliberate. An API that distinguished them would confirm which
    // usernames exist, which is exactly how account lists get harvested. So the
    // wording stays honest about covering both.
    if (error.status === 401) {
      return intent === "password"
        ? { fieldErrors: { username: "Incorrect username or password." } }
        : {
            fieldErrors: { code: "That code is invalid or has expired." },
            otp: keepOtp,
          };
    }
    return { formError: error.message, otp: keepOtp };
  }
  return { formError: "Something went wrong. Please try again.", otp: keepOtp };
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/dashboard";

  const fieldErrors = actionData?.fieldErrors;
  const formError = actionData?.formError;
  const otpPhaseFromServer = actionData?.otp;

  // Keep the phone tab selected across OTP round-trips.
  const [tab, setTab] = useState<"password" | "phone">(
    otpPhaseFromServer ? "phone" : "password",
  );
  // Local override lets "Use a different number" step back to the request phase.
  const [otpReset, setOtpReset] = useState(false);
  const phase: "request" | "verify" =
    otpPhaseFromServer && !otpReset ? "verify" : "request";
  const otpPhone = otpPhaseFromServer?.phone ?? "";

  useEffect(() => {
    if (otpPhaseFromServer) {
      setTab("phone");
      setOtpReset(false);
    }
  }, [otpPhaseFromServer]);

  const submitting = navigation.state === "submitting";
  const busyIntent = navigation.formData?.get("intent");

  // Subtle "bottom sheet" entrance — only on mobile, where the card is docked
  // to the bottom. Driven imperatively (rather than via `initial`) so it plays
  // whether or not the page was server-rendered, and honours reduced motion.
  const sheetControls = useAnimationControls();
  const reduceMotion = useReducedMotion();
  useIsomorphicLayoutEffect(() => {
    const isMobile = window.matchMedia("(max-width: 1023px)").matches;
    if (!isMobile || reduceMotion) return;
    // Start fully below its docked position, then slide up into place.
    sheetControls.set({ y: "100%" });
    sheetControls.start({
      y: 0,
      transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
    });
  }, [sheetControls, reduceMotion]);

  return (
    <main className="relative min-h-dvh w-full overflow-hidden lg:grid lg:grid-cols-2">
      {/* Mobile / tablet only: full-bleed background photo behind the docked
          card, over a dark base so it reads cleanly before the image loads. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-zinc-900 bg-cover bg-center lg:hidden"
        style={{ backgroundImage: LOGIN_BG }}
      />
      {/* Legibility wash: keeps the top breathable and deepens toward the card. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/30 to-black/80 lg:hidden"
      />

      {/* Large screens only: the photo becomes the left column of the grid. */}
      <aside
        className="relative hidden overflow-hidden bg-cover bg-center lg:block"
        style={{ backgroundImage: LOGIN_BG }}
      >
        {/* Brand-tinted overlay: adds depth and ties the photo to the brand. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-linear-to-tr from-black/70 via-success/20 to-success/25"
        />

        {/* The column's content: one centred stack — mark, wordmark, then the
            promise. It only exists at lg — below that the mark moves into the
            card header, so the logo is never announced twice. */}
        <div className="relative flex h-full flex-col items-center justify-center gap-8 p-10 text-center text-white xl:p-12">
          <div className="flex flex-col items-center gap-4">
            <img
              src={LOGO_SRC}
              alt=""
              className="size-20 select-none rounded-2xl bg-white/90 p-2.5 ring-1 ring-white/25"
              draggable={false}
            />
            <div className="leading-tight">
              <p className="font-sen text-2xl font-bold tracking-tight">YADAH</p>
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.25em] text-white/70">
                Dynamic Enterprise
              </p>
            </div>
          </div>

          <div className="max-w-sm space-y-3">
            <h2 className="font-sen text-3xl font-bold leading-snug xl:text-4xl">
              Susu, savings and loans — in one place.
            </h2>
            <p className="text-sm text-white/75">
              Sign in to manage customers, accounts and daily collections.
            </p>
          </div>
        </div>
      </aside>

      {/* Theme switcher — floats top-right. */}
      <ThemeToggle className="absolute right-4 top-4 z-20" />

      {/* Layout: card docked to the bottom over the photo on mobile; a plain,
          theme-aware panel filling the right grid column on large screens. */}
      <div className="relative z-10 flex min-h-dvh flex-col justify-end sm:items-center sm:justify-center sm:p-6 lg:min-h-0 lg:bg-white lg:p-0 dark:lg:bg-zinc-950">
        {/* Below lg: a translucent, theme-aware card. At lg: chrome falls away
            and it becomes a centered form panel. */}
        <motion.section
          initial={false}
          animate={sheetControls}
          className="login-sheet relative w-full overflow-hidden text-foreground max-lg:rounded-t-[2.5rem] max-lg:bg-white max-lg:px-6 max-lg:pb-[max(2rem,env(safe-area-inset-bottom))] max-lg:pt-8 max-lg:ring-1 max-lg:ring-black/5 max-lg:backdrop-blur-xl sm:max-w-md sm:max-lg:rounded-[2rem] sm:max-lg:pb-8 lg:max-w-sm lg:px-6 lg:py-12 dark:max-lg:bg-zinc-950/85 dark:max-lg:ring-white/10"
        >
          <div className="relative z-10">
            {/* On mobile this heading lives over the photo (see above); here it
                only shows in the desktop panel. */}


            {formError && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-red-200 "
              >
                {formError}
              </div>
            )}

            {/* Sign-in method picker. Controlled so OTP round-trips keep the
                phone tab selected (see the effect above). */}
            <div className="mb-6 flex flex-col items-center gap-4">
              {/* Below lg this is the only place the brand appears; at lg the
                  photo column carries it, so it drops out here. */}
              <img
                src={LOGO_SRC}
                alt="Yadah Dynamic Enterprise"
                className="size-14 select-none lg:hidden"
                draggable={false}
              />
              <div className="space-y-1">
                <h1 className="font-bold text-3xl font-sen text-center">Welcome Back!</h1>
                <p className="text-muted text-center">Sign in securely to your account</p>
              </div>
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
                    inputProps={{
                      autoComplete: "username",
                      autoCapitalize: "none",
                      className: FIELD_CLASS,
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
                    inputProps={{
                      autoComplete: "current-password",
                      className: FIELD_CLASS,
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
                  className={SUBMIT_CLASS}
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
              /* Phone OTP: request → verify */
              <Form method="post" className="space-y-5" replace>
                <input type="hidden" name="redirectTo" value={redirectTo} />

                <div className="space-y-1.5">
                  <TextInput
                    name="phone"
                    label="Phone number"
                    type="tel"
                    isRequired
                    isInvalid={Boolean(fieldErrors?.phone)}
                    isReadOnly={phase === "verify"}
                    defaultValue={otpPhone}
                    inputProps={{
                      inputMode: "numeric",
                      autoComplete: "tel",
                      className: FIELD_CLASS,
                    }}
                  />
                  <FieldError message={fieldErrors?.phone} />
                </div>

                {phase === "verify" && (
                  <div className="space-y-1.5">
                    <TextInput
                      name="code"
                      label="Verification code"
                      isRequired
                      isInvalid={Boolean(fieldErrors?.code)}
                      inputProps={{
                        inputMode: "numeric",
                        autoComplete: "one-time-code",
                        maxLength: 6,
                        className: FIELD_CLASS,
                      }}
                    />
                    <FieldError message={fieldErrors?.code} />
                    <p className="text-xs text-muted">
                      We sent a code to {otpPhone}.
                    </p>
                  </div>
                )}

                {phase === "request" ? (
                  <Button
                    type="submit"
                    name="intent"
                    value="otp-request"
                    variant="primary"
                    fullWidth
                    className={SUBMIT_CLASS}
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
                ) : (
                  <div className="space-y-3">
                    <Button
                      type="submit"
                      name="intent"
                      value="otp-verify"
                      variant="primary"
                      fullWidth
                      className={SUBMIT_CLASS}
                      isDisabled={submitting}
                    >
                      {submitting && busyIntent === "otp-verify"
                        ? "Verifying…"
                        : "Verify & sign in"}
                    </Button>
                    <div className="flex items-center justify-between text-sm">
                      <Button
                        type="submit"
                        name="intent"
                        value="otp-request"
                        variant="ghost"
                        isDisabled={submitting}
                      >
                        Resend code
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onPress={() => setOtpReset(true)}
                      >
                        Use a different number
                      </Button>
                    </div>
                  </div>
                )}
              </Form>
            )}

            {/* Switch between auth methods (replaces the old forgot-password link). */}
            <p className="mt-6 text-center text-sm">
              <button
                type="button"
                onClick={() => {
                  setTab(tab === "password" ? "phone" : "password");
                  setOtpReset(false);
                }}
                className="font-medium text-success dark:text-success"
              >
                {tab === "password"
                  ? "Login with phone"
                  : "Login with username and password"}
              </button>
            </p>
          </div>
        </motion.section>
      </div>
    </main>
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
