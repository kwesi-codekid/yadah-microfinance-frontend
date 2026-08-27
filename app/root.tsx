import { ThemeProvider } from "next-themes";
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import { RouteProgress } from "~/components/route-progress";
import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/sonner";
import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  { rel: "apple-touch-icon", href: "/logo.png" },
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
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes writes the theme class before paint, which the server cannot
    // predict — so the mismatch on <html> is expected, not a bug to chase.
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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

export default function App() {
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
