/**
 * The opening moment. A gold ring closes once around the company mark — a susu
 * cycle completing — and that ring is also the progress indicator, so nothing
 * else on the screen needs to move.
 */
export function SplashScreen({ durationMs }: { durationMs: number }) {
  return (
    <div
      role="status"
      aria-label="Loading Yadah Dynamic Enterprise"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-brand-navy px-6"
      style={
        {
          "--splash-duration": `${durationMs}ms`,
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        } as React.CSSProperties
      }
    >
      {/* A single soft light source behind the mark, so the navy is not flat. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 size-[min(80vw,34rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-sky/12 blur-3xl"
      />

      <div className="relative flex flex-col items-center gap-9">
        <div className="splash-mark relative size-36 sm:size-44">
          <svg
            viewBox="0 0 100 100"
            className="absolute inset-0 size-full -rotate-90"
            aria-hidden="true"
          >
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              className="text-white/15"
            />
            {/* Sky: the dashboard's calm accent, which holds its contrast on
                the navy ground where the ink action colour cannot. */}
            <circle
              className="splash-ring"
              pathLength={1}
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="var(--brand-sky)"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>

          <span className="absolute inset-[11%] flex items-center justify-center rounded-full bg-white p-3.5 shadow-2xl shadow-black/30">
            <img
              src="/logo.png"
              alt="Yadah Dynamic Enterprise"
              className="size-full object-contain"
              draggable={false}
            />
          </span>
        </div>

        <div className="splash-word flex flex-col items-center gap-2 text-center">
          <p className="font-heading text-3xl leading-none font-bold tracking-tight text-brand-sky sm:text-4xl">
            YADAH
          </p>
          <p className="font-heading text-[0.7rem] leading-none font-semibold tracking-[0.3em] text-white/60 uppercase sm:text-xs">
            Dynamic Enterprise
          </p>
        </div>
      </div>

      <p className="splash-tagline absolute inset-x-0 bottom-[max(2.5rem,env(safe-area-inset-bottom))] text-center text-sm text-white/45">
        Susu · Savings · Loans · Hire purchase
      </p>
    </div>
  );
}
