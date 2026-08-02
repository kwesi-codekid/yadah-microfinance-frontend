import { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";

type SplashScreenProps = {
  /** Called once the intro has finished (after `duration`). */
  onDone?: () => void;
  /** How long the splash stays up, in ms. Default 2600. */
  duration?: number;
  /** Tagline under the wordmark. */
  tagline?: string;
};

/** A single financial glyph that drifts slowly behind the mark. */
type FloatItem = {
  icon: React.ReactNode;
  /** left / top as CSS percentages */
  x: string;
  y: string;
  size: number;
  delay: number;
};

const CardIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="M2.5 9.5h19" strokeWidth={2} />
    <path d="M6 15.5h4" strokeLinecap="round" />
  </svg>
);

const CoinIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v10M9.5 9.5a2.5 2 0 0 1 5 0c0 2.5-5 1-5 3.5a2.5 2 0 0 0 5 0" strokeLinecap="round" />
  </svg>
);

const ChartIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M3 20h18" strokeLinecap="round" />
    <path d="M5 16l4-5 3.5 3L20 6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 6h4v4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const WalletIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v0" strokeLinecap="round" />
    <rect x="3" y="7" width="18" height="12.5" rx="2.5" />
    <circle cx="16.5" cy="13" r="1.4" />
  </svg>
);

const CediIcon = (
  <svg viewBox="0 0 24 24" fill="none">
    <text
      x="12"
      y="12"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize="22"
      fontWeight="700"
      fill="currentColor"
    >
      ₵
    </text>
  </svg>
);

const CediCoinIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <circle cx="12" cy="12" r="9" />
    <text
      x="12"
      y="12.5"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize="12"
      fontWeight="700"
      fill="currentColor"
      stroke="none"
    >
      ₵
    </text>
  </svg>
);

const ICONS = [CediIcon, CardIcon, CediCoinIcon, ChartIcon, CoinIcon, WalletIcon];

const FLOATERS: FloatItem[] = [
  { x: "8%", y: "12%", size: 20 }, { x: "22%", y: "8%", size: 16 },
  { x: "38%", y: "14%", size: 22 }, { x: "62%", y: "10%", size: 18 },
  { x: "78%", y: "9%", size: 24 }, { x: "92%", y: "16%", size: 16 },
  { x: "6%", y: "30%", size: 24 }, { x: "18%", y: "38%", size: 18 },
  { x: "84%", y: "28%", size: 20 }, { x: "94%", y: "38%", size: 22 },
  { x: "11%", y: "52%", size: 18 }, { x: "90%", y: "52%", size: 18 },
  { x: "4%", y: "68%", size: 22 }, { x: "20%", y: "64%", size: 16 },
  { x: "80%", y: "66%", size: 24 }, { x: "96%", y: "70%", size: 18 },
  { x: "10%", y: "86%", size: 20 }, { x: "28%", y: "90%", size: 22 },
  { x: "44%", y: "84%", size: 16 }, { x: "58%", y: "91%", size: 20 },
  { x: "72%", y: "86%", size: 24 }, { x: "88%", y: "90%", size: 18 },
  { x: "32%", y: "50%", size: 14 }, { x: "68%", y: "48%", size: 14 },
].map((f, i) => ({
  ...f,
  icon: ICONS[i % ICONS.length],
  delay: (i % 7) * 0.28,
}));

export const FINANCE_BACKDROP =
  "radial-gradient(115% 100% at 50% 0%, #ffffff 0%, #eef8f6 45%, #bfe5dd 100%)";

export function FinanceMotifs({
  glyphClassName = "text-white/[0.18]",
  className,
}: {
  /** Tailwind text-color class for the drifting glyphs (defaults to faint white). */
  glyphClassName?: string;
  /** Extra classes for the absolute container (e.g. to gate visibility). */
  className?: string;
} = {}) {
  const reduce = useReducedMotion();
  return (
    <div
      aria-hidden
      className={["pointer-events-none absolute inset-0", className]
        .filter(Boolean)
        .join(" ")}
    >
      {FLOATERS.map((f, i) => (
        <motion.div
          key={i}
          className={`absolute -translate-x-1/2 -translate-y-1/2 ${glyphClassName}`}
          style={{ left: f.x, top: f.y, width: f.size, height: f.size }}
          initial={{ opacity: 0, y: 0 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: [0, i % 2 ? 10 : -10, 0] }}
          transition={
            reduce
              ? { duration: 0.6, delay: f.delay }
              : {
                  opacity: { duration: 0.8, delay: f.delay },
                  y: {
                    duration: 5 + (i % 4),
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: f.delay,
                  },
                }
          }
        >
          {f.icon}
        </motion.div>
      ))}
    </div>
  );
}

export function SplashScreen({
  onDone,
  duration = 2600,
  tagline = "Susu · Savings · Loans",
}: SplashScreenProps) {
  const reduce = useReducedMotion();

  useEffect(() => {
    const t = setTimeout(() => onDone?.(), duration);
    return () => clearTimeout(t);
  }, [duration, onDone]);

  return (
    <motion.div
      role="status"
      aria-label="Loading Yadah Dynamic Enterprise"
      className="fixed inset-0 z-50 flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 text-black"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        background: FINANCE_BACKDROP,
      }}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: "easeInOut" }}
    >
      {/* Floating financial motifs — the "banking" texture of the screen */}
      <FinanceMotifs glyphClassName="text-black/10" />

      {/* Subtle radial highlight behind the mark to make the logo pop */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[min(70vw,26rem)] w-[min(70vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/20 blur-3xl"
      />

      <div className="relative flex flex-col items-center gap-6 sm:gap-8">
        {/* Logo mark in a soft "app tile" so it reads as an installed banking app */}
        <div className="relative flex aspect-square w-32 items-center justify-center sm:w-40 md:w-44">
          {!reduce && (
            <motion.span
              aria-hidden
              className="absolute inset-0 aspect-square rounded-full border border-black/20"
              initial={{ scale: 0.9, opacity: 0.5 }}
              animate={{ scale: 1.3, opacity: 0 }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
            />
          )}
          <motion.div
            className="relative flex aspect-square w-[86%] items-center justify-center rounded-full bg-white/70 ring-1 ring-black/10 backdrop-blur-sm"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.82 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <img
              src="/favicon.png"
              alt="Yadah Dynamic Enterprise"
              className="block w-[72%] select-none"
              draggable={false}
            />
          </motion.div>
        </div>

        {/* Wordmark */}
        <motion.div
          className="flex flex-col items-center gap-1 text-center"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.25, ease: "easeOut" }}
        >
          <h1 className="text-2xl font-extrabold tracking-tight text-black sm:text-3xl md:text-4xl">
            YADAH
          </h1>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-black/70 sm:text-sm">
            Dynamic Enterprise
          </p>
        </motion.div>

        {/* Tagline */}
        <motion.p
          className="max-w-[16rem] text-center text-sm text-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          {tagline}
        </motion.p>
      </div>

      {/* Progress bar pinned near the bottom */}
      <div className="absolute inset-x-0 bottom-[max(2rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-3 px-6">
        <div className="h-1 w-40 overflow-hidden rounded-full bg-black/15 sm:w-56">
          <motion.div
            className="h-full rounded-full bg-black"
            initial={{ width: reduce ? "100%" : "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: duration / 1000, ease: "easeInOut" }}
          />
        </div>
        <p className="flex items-center gap-1.5 text-[0.7rem] font-medium text-black/60">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
          </svg>
          Bank-grade secure
        </p>
      </div>
    </motion.div>
  );
}
