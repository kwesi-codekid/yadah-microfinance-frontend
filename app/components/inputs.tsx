import {
    Calendar,
    DateField,
    DatePicker,
    Input,
    Label,
    TextArea,
    TextField,
    type InputProps,
    type TextAreaProps,
    type TextFieldProps,
} from "@heroui/react"
import { CalendarDate, parseDate } from "@internationalized/date"
import { useState, type ReactNode } from "react"

const labelClass = " text-foreground font-medium"

export const inputClass = "border-2 border-border shadow-none"

interface TextInputProps extends Omit<TextFieldProps, "children"> {
    label?: ReactNode
    /** Replaces the default label styling where a denser label is wanted. */
    labelClassName?: string
    inputProps?: InputProps
    startContent?: ReactNode
    children?: ReactNode
}

export const TextInput = ({
    label,
    labelClassName,
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
            {label != null && (
                <Label className={labelClassName ?? labelClass}>{label}</Label>
            )}
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

/** `YYYY-MM-DD` in, `CalendarDate` out — anything unparseable reads as blank. */
const toCalendarDate = (value?: string) => {
    if (!value) return null
    try {
        return parseDate(value.slice(0, 10))
    } catch {
        return null
    }
}

interface DateInputProps {
    name: string
    label?: ReactNode
    /** Replaces the default label styling where a denser label is wanted. */
    labelClassName?: string
    /** `YYYY-MM-DD`, the shape the form reads back. */
    defaultValue?: string
    isRequired?: boolean
    isInvalid?: boolean
    isDisabled?: boolean
    className?: string
    /** Lands on the bordered group — the date field's answer to `inputProps`. */
    groupProps?: DateField["GroupProps"]
    describedBy?: string
    /** Narrows the calendar; without them it spans 1900–2099. */
    minValue?: CalendarDate
    maxValue?: CalendarDate
}

export const DateInput = ({
    name,
    label,
    labelClassName,
    defaultValue,
    isRequired,
    isInvalid,
    isDisabled,
    className,
    groupProps,
    describedBy,
    minValue,
    maxValue,
}: DateInputProps) => {
    const [value, setValue] = useState(() => toCalendarDate(defaultValue))

    return (
        <>
            {/* React Aria's own hidden input carries `form=""`, so it never submits. */}
            <input type="hidden" name={name} value={value?.toString() ?? ""} />
            <DatePicker
                value={value}
                onChange={setValue}
                granularity="day"
                isRequired={isRequired}
                isInvalid={isInvalid}
                isDisabled={isDisabled}
                className={["text-left", className].filter(Boolean).join(" ")}
            >
                {label != null && (
                    <Label className={labelClassName ?? labelClass}>
                        {label}
                    </Label>
                )}

                <DateField.Group
                    {...groupProps}
                    aria-describedby={describedBy}
                    className={[inputClass, groupProps?.className]
                        .filter(Boolean)
                        .join(" ")}
                >
                    <DateField.Input>
                        {(segment) => <DateField.Segment segment={segment} />}
                    </DateField.Input>
                    <DateField.Suffix>
                        <DatePicker.Trigger>
                            <DatePicker.TriggerIndicator />
                        </DatePicker.Trigger>
                    </DateField.Suffix>
                </DateField.Group>

                <DatePicker.Popover>
                    <Calendar minValue={minValue} maxValue={maxValue}>
                        <Calendar.Header>
                            <Calendar.NavButton slot="previous" />
                            {/* The heading is the year picker's trigger — a birth
                                year is too far back to reach a month at a time. */}
                            <Calendar.YearPickerTrigger>
                                <Calendar.YearPickerTriggerHeading />
                                <Calendar.YearPickerTriggerIndicator />
                            </Calendar.YearPickerTrigger>
                            <Calendar.NavButton slot="next" />
                        </Calendar.Header>

                        <Calendar.Grid>
                            <Calendar.GridHeader>
                                {(day) => (
                                    <Calendar.HeaderCell>
                                        {day}
                                    </Calendar.HeaderCell>
                                )}
                            </Calendar.GridHeader>
                            <Calendar.GridBody>
                                {(date) => <Calendar.Cell date={date} />}
                            </Calendar.GridBody>
                        </Calendar.Grid>

                        {/* Overlays the day grid; it hides itself while closed. */}
                        <Calendar.YearPickerGrid>
                            <Calendar.YearPickerGridBody>
                                {({ year }) => (
                                    <Calendar.YearPickerCell year={year} />
                                )}
                            </Calendar.YearPickerGridBody>
                        </Calendar.YearPickerGrid>
                    </Calendar>
                </DatePicker.Popover>
            </DatePicker>
        </>
    )
}
