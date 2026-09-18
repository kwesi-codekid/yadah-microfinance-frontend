import { ThemeProvider } from "next-themes";
import { useEffect } from "react";
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";

import { RouteProgress } from "~/components/route-progress";
import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/sonner";
import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.ico", sizes: "16x16 32x32 48x48" },
  { rel: "icon", href: "/icons/favicon-32.png", type: "image/png", sizes: "32x32" },
  // 180px, on white: iOS ignores transparency and would otherwise fill it black.
  { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png", sizes: "180x180" },
];

export const meta: Route.MetaFunction = () => [
  { title: "Yadah Dynamic Enterprise" },
  {
    name: "description",
    content:
      "Susu, savings, loans and hire purchase for Yadah Dynamic Enterprise.",
  },
  // The splash and the sidebar are navy in both themes; match the browser chrome.
  { name: "theme-color", content: "#033F6F" },
  // iOS reads neither the manifest's `display` nor its `theme_color`, so the
  // standalone window is asked for the old way.
  { name: "apple-mobile-web-app-capable", content: "yes" },
  { name: "mobile-web-app-capable", content: "yes" },
  { name: "apple-mobile-web-app-status-bar-style", content: "default" },
];

/**
 * Catch Chromium's install prompt before React exists.
 *
 * `beforeinstallprompt` fires once, early, and usually lands before hydration.
 * Miss it and there is no install button until the next page load — so this
 * runs in the document head, keeps the event, and tells the app it has one.
 */
const CATCH_INSTALL_PROMPT = `
window.__yadahInstallPrompt = null;
window.addEventListener("beforeinstallprompt", function (event) {
  event.preventDefault();
  window.__yadahInstallPrompt = event;
  window.dispatchEvent(new Event("yadah:installable"));
});
`;

export function Layout({ children }: { children: React.ReactNode }) {
  // Two products on one host install as two apps: staff open the whole branch
  // at the splash, a customer opens their own accounts at the portal. Pointing
  // both at one manifest would land customers on the staff sign-in.
  const portal = useLocation().pathname.startsWith("/portal");

  return (
    // next-themes writes the theme class before paint, which the server cannot
    // predict — so the mismatch on <html> is expected, not a bug to chase.
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link
          rel="manifest"
          href={portal ? "/portal.webmanifest" : "/manifest.webmanifest"}
        />
        {/* What iOS writes under the home-screen icon. */}
        <meta
          name="apple-mobile-web-app-title"
          content={portal ? "My Yadah" : "Yadah"}
        />
        <script dangerouslySetInnerHTML={{ __html: CATCH_INSTALL_PROMPT }} />
        <Meta />
        <Links />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* Above everything, including the sidebar and any open drawer. */}
          <RouteProgress />
          {children}
          <Toaster position="top-right" />
        </ThemeProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Register the service worker — the one behind push, and the reason the app
 * can be installed at all. It waits for `load` so it never competes with the
 * first screen's own requests, and a failure costs push and the offline page
 * and nothing else, so it is swallowed.
 */
function useServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);
}

export default function App() {
  useServiceWorker();
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let heading = "Something went wrong";
  let detail = "The page did not load. Try again, or go back to the dashboard.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      heading = "Page not found";
      detail = "That address does not match anything in the app.";
    } else if (error.status === 403) {
      heading = "Not your access level";
      detail = error.statusText || "Ask an administrator if you need this page.";
    } else {
      heading = `Error ${error.status}`;
      detail = error.statusText || detail;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    detail = error.message;
    stack = error.stack;
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-16">
      <div className="max-w-md space-y-2 text-center">
        <h1 className="font-heading text-3xl font-bold tracking-tight">{heading}</h1>
        <p className="text-muted-foreground">{detail}</p>
      </div>

      <Button asChild size="lg">
        <Link to="/dashboard">Go to dashboard</Link>
      </Button>

      {stack && (
        <pre className="w-full max-w-3xl overflow-x-auto rounded-lg border border-border bg-muted p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
