import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";

/**
 * Light/dark switch. The rendered icon depends on the resolved theme, which the
 * server cannot know — so it renders the sun until mounted rather than
 * guessing and flipping on hydration.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={className}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <MoonIcon /> : <SunIcon />}
      <span className="sr-only">
        Switch to {isDark ? "light" : "dark"} theme
      </span>
    </Button>
  );
}
