/**
 * Paths referenced from both the server and the browser. Client-safe on
 * purpose: a component that needs one of these must not have to import
 * `session.server.ts` to get it.
 */

export const LOGIN_PATH = "/login";
export const VERIFY_OTP_PATH = "/login/verify";
export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const RESET_PASSWORD_PATH = "/reset-password";
export const CHANGE_PASSWORD_PATH = "/change-password";

/** Where a successful sign-in lands, and where a forbidden route sends you. */
export const DEFAULT_LANDING = "/dashboard";

/* The customer portal: its own login, its own session, its own home. */
export const PORTAL_HOME = "/portal";
export const PORTAL_LOGIN_PATH = "/portal/login";
export const PORTAL_VERIFY_PATH = "/portal/login/verify";
