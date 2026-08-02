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

const labelClass = " text-foreground font-medium"

export const inputClass = "border-2 border-border shadow-none"

interface TextInputProps extends Omit<TextFieldProps, "children"> {
    label?: ReactNode
    inputProps?: InputProps
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
