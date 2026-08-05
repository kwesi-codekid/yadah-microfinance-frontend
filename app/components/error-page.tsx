import { ArrowLeft, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@heroui/react";

export function ErrorPage({
  code,
  title,
  details,
  stack,
}: {
  /** Shown large above the title — a status code, or nothing for thrown errors. */
  code?: string;
  title: string;
  details: string;
  /** Dev-only stack trace. */
  stack?: string;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand dark:bg-brand-dark/20 dark:text-brand-light">
          <TriangleAlert size={22} aria-hidden="true" />
        </div>

        {code && (
          <p className="mt-4 font-heading text-4xl font-bold text-muted">
            {code}
          </p>
        )}

        <h1 className="mt-2 font-heading text-xl font-semibold text-foreground">
          {title}
        </h1>
        <p className="mt-2 text-sm text-muted">{details}</p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="rounded-md"
            onPress={() => window.history.back()}
          >
            <ArrowLeft size={15} aria-hidden="true" />
            Go back
          </Button>
          <Button
            size="sm"
            className="rounded-md bg-success text-white"
            onPress={() => window.location.reload()}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Refresh
          </Button>
        </div>

        {stack && (
          <pre className="mt-6 max-h-64 overflow-auto rounded-xl bg-surface-tertiary p-4 text-left text-xs text-muted">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}
