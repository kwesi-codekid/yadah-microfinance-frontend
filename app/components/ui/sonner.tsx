import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * Toasts carry their tone in their colour: a save is green, a refusal red, so
 * the outcome reads before the sentence does.
 *
 * `richColors` is what switches sonner from one popover-coloured toast to a
 * per-type one; the vars below then point its `--{type}-bg/-border/-text` at
 * our own tokens, so a toast is tinted the same way every other tone surface
 * in the app is — `bg-{tone}-subtle`, `border-{tone}/30`, `text-{tone}`, the
 * pattern `FormNotice` uses. Both themes come along for free, since each token
 * is already redefined under `.dark`. Sonner's error type is our `danger`.
 *
 * Border alpha is written as `color-mix` rather than `/30`, because these are
 * plain CSS custom properties and Tailwind's slash modifier is not available
 * here — it compiles to the same `color-mix(in oklab, …)` either way.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      richColors
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",

          "--success-bg": "var(--success-subtle)",
          "--success-text": "var(--success)",
          "--success-border": "color-mix(in oklab, var(--success) 30%, transparent)",

          "--error-bg": "var(--danger-subtle)",
          "--error-text": "var(--danger)",
          "--error-border": "color-mix(in oklab, var(--danger) 30%, transparent)",

          "--warning-bg": "var(--warning-subtle)",
          "--warning-text": "var(--warning)",
          "--warning-border": "color-mix(in oklab, var(--warning) 30%, transparent)",

          "--info-bg": "var(--info-subtle)",
          "--info-text": "var(--info)",
          "--info-border": "color-mix(in oklab, var(--info) 30%, transparent)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
