import { BellOffIcon, BellRingIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";

/**
 * Browser push for this device: one card that says whether it is on, and one
 * button that flips it. It talks to the browser itself — permission, the
 * service worker, `PushManager` — and posts the resulting subscription to the
 * notifications route, which is the only thing that holds an access token.
 *
 * Renders nothing useful until hydrated, because the browser is the only place
 * the answer lives, and nothing at all when the server has no VAPID key —
 * in-app notifications still work, push is simply not offered.
 */
export function PushToggle({ publicKey }: { publicKey: string }) {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const [state, setState] = useState<"checking" | "unsupported" | "blocked" | "off" | "on">(
    "checking",
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("blocked");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        const sub = await reg?.pushManager.getSubscription();
        if (!cancelled) setState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setState("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) toast.success(fetcher.data.message);
      else toast.error(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data]);

  const enable = async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyBytes(publicKey),
      });
      const json = sub.toJSON();
      fetcher.submit(
        {
          intent: "push-subscribe",
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
        },
        { method: "post" },
      );
      setState("on");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not turn push on.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        fetcher.submit({ intent: "push-unsubscribe", endpoint }, { method: "post" });
      }
      setState("off");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not turn push off.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "unsupported") return null;

  const on = state === "on";
  const Icon = on ? BellRingIcon : BellOffIcon;

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-card-foreground">
      <div className="flex min-w-0 items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {state === "checking"
              ? "Push on this device"
              : on
                ? "Push is on for this device"
                : state === "blocked"
                  ? "Push is blocked by the browser"
                  : "Push is off for this device"}
          </p>
          <p className="text-xs text-muted-foreground">
            {state === "blocked"
              ? "Allow notifications for this site in the browser's settings, then come back here."
              : "A notification on this screen also lands on the device, even with the app closed. Each device is switched on separately."}
          </p>
        </div>
      </div>
      {state !== "blocked" && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy || state === "checking" || fetcher.state !== "idle"}
          onClick={on ? disable : enable}
        >
          {busy && <Loader2Icon className="animate-spin" />}
          {on ? "Turn off" : "Turn on"}
        </Button>
      )}
    </section>
  );
}

/** A URL-safe base64 VAPID key, as the API hands it, into the bytes `subscribe` wants. */
function vapidKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (key.length % 4)) % 4);
  const base64 = (key + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
