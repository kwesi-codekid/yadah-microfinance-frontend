import { Toast, toast } from "@heroui/react"
import type { ReactNode } from "react"

/**
 * Global toast outlet. Mount this once near the app root (see `root.tsx`).
 * It renders into the shared queue, so fire toasts from anywhere with the
 * `notify` helper below — no props or context wiring required.
 */
export function Toaster() {
    return <Toast.Provider placement="top end" />
}

type NotifyOptions = {
    description?: ReactNode
    /** Auto-dismiss after N ms. Omit for the HeroUI default. */
    timeout?: number
}

/**
 * Imperative toast helpers. Call from event handlers, route actions, etc.
 *
 *   notify.success("Signed in")
 *   notify.error("Invalid code", { description: "Request a new one." })
 */
export const notify = {
    success: (message: ReactNode, options?: NotifyOptions) =>
        toast.success(message, options),
    error: (message: ReactNode, options?: NotifyOptions) =>
        toast.danger(message, options),
    info: (message: ReactNode, options?: NotifyOptions) =>
        toast.info(message, options),
    warning: (message: ReactNode, options?: NotifyOptions) =>
        toast.warning(message, options),
}
