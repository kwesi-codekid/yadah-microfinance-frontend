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
    children?: ReactNode
}

export const TextInput = ({
    label,
    inputProps,
    children,
    className,
    ...fieldProps
}: TextInputProps) => {
    return (
        <TextField
            {...fieldProps}
            className={["text-left", className].filter(Boolean).join(" ")}
        >
            {label != null && <Label className={labelClass}>{label}</Label>}
            <Input
                {...inputProps}
                className={[inputClass, inputProps?.className]
                    .filter(Boolean)
                    .join(" ")}
            />
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
