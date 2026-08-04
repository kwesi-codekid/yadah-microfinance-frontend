import { useRef, useState } from "react";
import { Form } from "react-router";
import { Button } from "@heroui/react";
import { Field, SelectField } from "~/components/form-fields";
import { ConfirmModal } from "~/components/modals";
import { SideDrawer } from "~/components/side-drawer";
import { ROLES, ROLE_LABELS, type AuthUser, type Role } from "~/lib/auth-client";

/** Which staff form is open, and on whom. `null` is closed. */
export type DrawerState =
  | { mode: "create" }
  | { mode: "edit"; user: AuthUser }
  | { mode: "reset"; user: AuthUser }
  | null;

export function StaffDrawer({
  state,
  onClose,
  submitting,
  fieldErrors,
  formError,
}: {
  state: DrawerState;
  onClose: () => void;
  submitting: boolean;
  fieldErrors?: Record<string, string>;
  formError?: string;
}) {
  const mode = state?.mode ?? "create";
  const user = state && "user" in state ? state.user : undefined;
  const title =
    mode === "create"
      ? "Add staff"
      : mode === "edit"
        ? "Edit staff"
        : "Reset password";
  const intent =
    mode === "create" ? "create" : mode === "edit" ? "update" : "reset-password";
  const submitLabel =
    mode === "create"
      ? "Create"
      : mode === "edit"
        ? "Save changes"
        : "Reset password";
  const formId = `staff-${mode}-${user?.id ?? "new"}`;

  return (
    <SideDrawer
      isOpen={state !== null}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            className="rounded-md"
            onPress={onClose}
            isDisabled={submitting}
          >
            Cancel
          </Button>
          {/* Lives outside the <form>, so `form` ties it back to one. */}
          <Button
            type="submit"
            form={formId}
            className="rounded-md bg-success"
            isDisabled={submitting}
          >
            {submitting ? "Saving…" : submitLabel}
          </Button>
        </>
      }
    >
      <Form id={formId} key={formId} method="post" className="space-y-5">
        <input type="hidden" name="intent" value={intent} />
        {user && <input type="hidden" name="id" value={user.id} />}

        {formError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {formError}
          </p>
        )}

        {mode !== "reset" && (
          <>
            <Field
              name="name"
              label="Full name"
              defaultValue={user?.name}
              error={fieldErrors?.name}
              inputProps={{ autoComplete: "name" }}
            />
            {mode === "create" && (
              <Field
                name="username"
                label="Username"
                error={fieldErrors?.username}
                inputProps={{ autoCapitalize: "none", autoComplete: "off" }}
              />
            )}
            <Field
              name="phone"
              label="Phone"
              defaultValue={user?.phone}
              error={fieldErrors?.phone}
              inputProps={{ inputMode: "numeric", placeholder: "0241234567" }}
            />
            <Field
              name="email"
              label="Email (optional)"
              type="email"
              defaultValue={user?.email}
              error={fieldErrors?.email}
              inputProps={{ autoComplete: "off" }}
            />
            <SelectField
              name="role"
              label="Role"
              defaultValue={user?.role ?? ""}
              placeholder="Select a role"
              error={fieldErrors?.role}
              options={ROLES.map((r) => ({
                value: r,
                label: ROLE_LABELS[r],
              }))}
            />
            {mode === "create" && (
              <div className="space-y-1.5">
                <Field
                  name="password"
                  label="Temporary password"
                  type="password"
                  error={fieldErrors?.password}
                  inputProps={{ autoComplete: "new-password" }}
                />
                <p className="text-xs text-muted">
                  Hand this to them — they'll be asked to replace it the first
                  time they sign in.
                </p>
              </div>
            )}
          </>
        )}

        {mode === "reset" && (
          <>
            <p className="text-sm text-muted">
              Set a new password for{" "}
              <span className="font-medium text-foreground">{user?.name}</span>.
            </p>
            <Field
              name="newPassword"
              label="New password"
              type="password"
              error={fieldErrors?.newPassword}
              inputProps={{ autoComplete: "new-password" }}
            />
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                name="mustChangePassword"
                defaultChecked
                className="size-4 rounded border-border accent-accent"
              />
              Require a password change at next sign-in
            </label>
          </>
        )}
      </Form>
    </SideDrawer>
  );
}

/** Inline POST for enable/disable. Disabling asks for confirmation first. */
export function StatusForm({
  id,
  name,
  intent,
  label,
  danger,
  children,
}: {
  id: string;
  name: string;
  intent: "disable" | "enable";
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);
  // Enabling is harmless and instantly reversible; disabling locks someone out.
  const needsConfirm = intent === "disable";

  return (
    <>
      <Form method="post" ref={formRef}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="intent" value={intent} />
        <button
          type={needsConfirm ? "button" : "submit"}
          onClick={needsConfirm ? () => setConfirming(true) : undefined}
          title={label}
          aria-label={label}
          className={[
            "flex size-7 items-center justify-center rounded-lg transition-colors",
            danger
              ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              : "text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40",
          ].join(" ")}
        >
          {children}
        </button>
      </Form>

      {needsConfirm && (
        <ConfirmModal
          isOpen={confirming}
          onOpenChange={setConfirming}
          title="Disable this staff member?"
          footer={
            <Button
              size="sm"
              variant="danger"
              className="rounded-md"
              onPress={() => {
                setConfirming(false);
                formRef.current?.requestSubmit();
              }}
            >
              Disable
            </Button>
          }
        >
          <p className="text-sm text-muted">
            <span className="font-medium text-foreground">{name}</span> will no
            longer be able to sign in. You can enable them again later.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span className="inline-flex items-center rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium text-foreground dark:bg-white/10">
      {ROLE_LABELS[role]}
    </span>
  );
}
