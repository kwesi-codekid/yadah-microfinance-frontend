import type { Config } from "@react-router/dev/config";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,

  /**
   * The hosts allowed to submit a form to this app.
   *
   * React Router refuses an action whose `Origin` header does not match the
   * origin it believes it is serving. Behind a TLS-terminating proxy that
   * belief is wrong: `react-router-serve` never enables Express `trust proxy`,
   * so it never reads `X-Forwarded-Proto` or `X-Forwarded-Host` and concludes
   * it is serving plain `http://` on whatever `Host` reached the container.
   * The browser sends `https://`, the two disagree, and every POST is aborted
   * — which reaches the person as "Something went wrong" on the first form
   * they submit, which is the login page.
   *
   * Naming the real hosts settles it without a custom server. This is not a
   * weakening: an origin that is not ours is still refused. Both the bare host
   * and the full origin are listed because the check has been spelled both
   * ways across 8.x releases.
   *
   * Local development needs no entry — the browser talks to Vite directly, so
   * the two origins already agree.
   */
  allowedActionOrigins: [
    "yadahdynamic.com",
    "*.yadahdynamic.com",
    "https://yadahdynamic.com",
    "https://staging.yadahdynamic.com",
  ],
} satisfies Config;
