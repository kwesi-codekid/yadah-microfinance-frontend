import { Toast, toast } from "@heroui/react"
import type { ReactNode } from "react"

export function Toaster() {
    return <Toast.Provider placement="top end" />
}

type NotifyOptions = {
    description?: ReactNode
    /** Auto-dismiss after N ms. Omit for the HeroUI default. */
    timeout?: number
}

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
