import { EyeIcon, EyeOffIcon, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "~/components/ui/input-group";

/**
 * One labelled input for the signed-out pages: an icon that says what the
 * field is for, the error the API or the pre-check produced, and — for
 * passwords — a reveal, because these are typed on phones in the field.
 */
export function AuthField({
  name,
  label,
  icon: Icon,
  error,
  hint,
  type = "text",
  ...props
}: Omit<React.ComponentProps<typeof InputGroupInput>, "id"> & {
  name: string;
  label: string;
  icon: LucideIcon;
  error?: string;
  hint?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  const id = `field-${name}`;

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>

      <InputGroup className="h-10 border-ring ring-3 ring-ring/50">
        <InputGroupAddon>
          <Icon className="text-muted-foreground" />
        </InputGroupAddon>

        <InputGroupInput
          id={id}
          name={name}
          type={isPassword && revealed ? "text" : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          {...props}
        />

        {isPassword && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-sm"
              onClick={() => setRevealed((shown) => !shown)}
              aria-label={revealed ? "Hide password" : "Show password"}
            >
              {revealed ? <EyeOffIcon /> : <EyeIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>

      {hint && !error ? <FieldDescription>{hint}</FieldDescription> : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </Field>
  );
}
