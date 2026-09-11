import { PenLineIcon } from "lucide-react";

/**
 * The picture of the customer's signature on a loan application or a
 * hire-purchase agreement. Small and to one side: it is evidence, read when
 * something is disputed, not a figure anyone works from day to day.
 */
export function SignatureCard({ url }: { url: string }) {
  return (
    <section className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="block w-56 shrink-0 overflow-hidden rounded-lg border border-border bg-white"
        title="Open the full picture"
      >
        <img src={url} alt="The customer's signature" className="aspect-[5/2] w-full object-contain" />
      </a>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <PenLineIcon className="size-4" />
        Customer&rsquo;s signature, photographed at signing.
      </p>
    </section>
  );
}
