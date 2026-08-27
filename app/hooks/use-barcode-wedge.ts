import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A barcode scanner is a keyboard that types very fast and presses Enter.
 *
 * So this listens to the whole document rather than to one box: keys that
 * arrive within `SCAN_GAP_MS` of each other are a scan in progress, and an
 * Enter at the end of a run of `SCAN_MIN_LENGTH` or more is the scan landing.
 * A human cannot type that fast, which is what lets the scanner stay live
 * while someone types into an ordinary input — the burst is caught and
 * swallowed before it lands there, and the Enter never submits a form.
 *
 * `onScan` returns whether the code meant anything; `state` carries that
 * answer for a couple of seconds so a tile can show it, then settles back.
 * `report` puts a code through the same path from any other reader — the
 * camera, for one.
 */
const SCAN_GAP_MS = 40;
const SCAN_MIN_LENGTH = 3;
const SETTLE_MS = 2400;

export type ScanState =
  | { kind: "ready" }
  | { kind: "hit"; code: string }
  | { kind: "miss"; code: string };

export function useBarcodeWedge(onScan: (code: string) => boolean) {
  const [state, setState] = useState<ScanState>({ kind: "ready" });
  const buffer = useRef("");
  const lastKey = useRef(0);
  const handler = useRef(onScan);
  handler.current = onScan;

  const report = useCallback((code: string) => {
    const found = handler.current(code);
    setState(found ? { kind: "hit", code } : { kind: "miss", code });
    return found;
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const now = performance.now();
      if (now - lastKey.current > SCAN_GAP_MS) buffer.current = "";
      lastKey.current = now;

      if (event.key === "Enter") {
        const code = buffer.current;
        buffer.current = "";
        if (code.length < SCAN_MIN_LENGTH) return;
        event.preventDefault();
        event.stopPropagation();
        report(code);
        return;
      }
      if (event.key.length === 1) buffer.current += event.key;
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [report]);

  useEffect(() => {
    if (state.kind === "ready") return;
    const t = setTimeout(() => setState({ kind: "ready" }), SETTLE_MS);
    return () => clearTimeout(t);
  }, [state]);

  return { state, report };
}
