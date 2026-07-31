import {
    Input,
    Label,
    TextArea,
    TextField,
    type InputProps,
    type TextAreaProps,
    type TextFieldProps,
} from "@heroui/react"
import type { ReactNode } from "react"

// px-3 matches the input's horizontal padding (--spacing * 3) so the label
// text lines up with the input value / placeholder.
const labelClass = " text-foreground font-medium"

/**
 * Shared field treatment: bordered, no shadow. Reused for OTP slots, etc.
 *
 * The invalid state is not handled here — `.input[data-invalid="true"]` in
 * app.css owns it, unlayered, so one red border wins over any per-field border
 * colour a caller passes in (e.g. login's `border-success/50`).
 */
export const inputClass = "border-2 border-border shadow-none"

interface TextInputProps extends Omit<TextFieldProps, "children"> {
    label?: ReactNode
    inputProps?: InputProps
    /**
     * Decorative icon shown inside the field, before the value. Purely visual —
     * it's hidden from assistive tech, which reads the `label` instead — and the
     * input gains matching left padding so the value clears it.
     */
    startContent?: ReactNode
    children?: ReactNode
}

export const TextInput = ({
    label,
    inputProps,
    startContent,
    children,
    className,
    ...fieldProps
}: TextInputProps) => {
    const input = (
        <Input
            {...inputProps}
            className={[
                inputClass,
                // The wrapper below is a plain div, so the input no longer
                // stretches as a direct flex child of TextField — pin it wide.
                startContent ? "w-full pl-10" : null,
                inputProps?.className,
            ]
                .filter(Boolean)
                .join(" ")}
        />
    )

    return (
        <TextField
            {...fieldProps}
            className={["text-left", className].filter(Boolean).join(" ")}
        >
            {label != null && <Label className={labelClass}>{label}</Label>}
            {startContent ? (
                <div className="relative w-full">
                    <span
                        aria-hidden
                        className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted"
                    >
                        {startContent}
                    </span>
                    {input}
                </div>
            ) : (
                input
            )}
            {children}
        </TextField>
    )
}

interface TextareaInputProps extends Omit<TextFieldProps, "children"> {
    label?: ReactNode
    textareaProps?: TextAreaProps
    children?: ReactNode
}

export const TextareaInput = ({
    label,
    textareaProps,
    children,
    ...fieldProps
}: TextareaInputProps) => {
    return (
        <TextField {...fieldProps}>
            {label != null && <Label className={labelClass}>{label}</Label>}
            <TextArea {...textareaProps} />
            {children}
        </TextField>
    )
}
