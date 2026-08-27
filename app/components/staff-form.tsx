import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  ShuffleIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Form, useFetcher, useNavigation } from "react-router";
import { toast } from "sonner";

import { SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ROLE_LABELS, ROLES, type Role } from "~/lib/auth";
import {
  checkPassword,
  checkUsername,
  PASSWORD_MAX,
  PASSWORD_MIN,
  suggestPassword,
  type ResolvedStatus,
  type Staff,
  type StaffActionResult,
} from "~/lib/staff";
import { cn } from "~/lib/utils";

/**
 * The staff account, as one form. Creating and editing post the same field
 * names — `~/lib/staff-form` parses both — so they share this rather than
 * keeping two copies in step by hand.
 *
 * It is laid out the way the customer form is laid out: the same sections, the
 * same small-caps field labels, the same footer bar. Two screens that both mean
 * "fill this in and save" should not feel like two different products.
 */
export function StaffForm({
  mode,
  staff,
  isSelf = false,
  error,
  details,
  cancelTo,
}: {
  mode: "create" | "edit";
  /** The account being edited; prefills every field. Omitted when creating. */
  staff?: Staff;
  /** The signed-in admin is editing their own account — the API locks the role. */
  isSelf?: boolean;
  /** The action's error message, if the last submission was rejected. */
  error?: string;
  /** `VALIDATION_ERROR` issues from the API, listed under the message. */
  details?: unknown;
  cancelTo: string;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const editing = mode === "edit";

  // The API checks the username against its own pattern, and a rejected
  // username costs the whole form. Catching it here points at the one field.
  const [username, setUsername] = useState(staff?.username ?? "");
  const usernameIssue = editing ? null : checkUsername(username);

  const [password, setPassword] = useState("");
  const passwordIssue = editing ? null : checkPassword(password);

  const [role, setRole] = useState<Role>(staff?.role ?? "collector");
  const roleMoved = editing && staff != null && role !== staff.role;

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  return (
    <Form
      method="post"
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        const issue = usernameIssue ?? passwordIssue;
        if (issue) {
          e.preventDefault();
          toast.error(issue);
        }
      }}
    >
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">{error}</p>
              <ValidationIssues details={details} />
            </div>
          </div>
        )}

        {/* Editing posts the role back too, so the picker still has to submit
            even when it is locked to what the account already holds. */}
        {isSelf && <input type="hidden" name="role" value={staff?.role ?? role} />}

        <Section title="Account">
          <div className="space-y-4">
            <Fld label="Full name" required>
              <Input
                name="name"
                defaultValue={staff?.name}
                required
                minLength={2}
                maxLength={100}
                autoComplete="off"
                placeholder="Ama Serwaa"
              />
            </Fld>

            <Fld
              label="Username"
              required={!editing}
              hint={editing ? "Cannot be changed." : undefined}
              issue={usernameIssue}
            >
              <Input
                name="username"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                readOnly={editing}
                required={!editing}
                aria-invalid={usernameIssue ? true : undefined}
                minLength={3}
                maxLength={30}
                autoComplete="off"
                spellCheck={false}
                placeholder="ama.serwaa"
                className={cn("lowercase", editing && "text-muted-foreground")}
              />
            </Fld>

            <Fld
              label="Role"
              required
              hint={isSelf ? "Locked on your own account." : undefined}
            >
              <Select
                name={isSelf ? undefined : "role"}
                value={role}
                onValueChange={(v) => setRole(v as Role)}
                disabled={isSelf}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Fld>
          </div>

          {roleMoved && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>Signs them out everywhere.</span>
            </p>
          )}
        </Section>

        <Section title="Contact">
          <div className="space-y-4">
            <Fld label="Phone" required>
              <Input
                name="phone"
                defaultValue={staff?.phone}
                required
                inputMode="numeric"
                pattern="0[25][0-9]{8}"
                placeholder="0241234567"
              />
            </Fld>
            <Fld label="Email">
              <Input
                type="email"
                name="email"
                defaultValue={staff?.email}
                placeholder="name@example.com"
              />
            </Fld>
          </div>
        </Section>

        {!editing && (
          <Section title="First password">
            <div className="space-y-4">
              <Fld
                label="Password"
                required
                hint={`At least ${PASSWORD_MIN} characters.`}
                issue={passwordIssue}
              >
                <PasswordField value={password} onChange={setPassword} />
              </Fld>
            </div>
          </Section>
        )}
      </div>

      {/* Pinned under the scroll, so Save is reachable without hunting for it. */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
        {/* The shared one, not a bare link: it slides the panel out before
            it navigates, keeps the listing's filters, and tells the router the
            list behind it has not changed and need not be read again. */}
        <SheetCancel to={cancelTo} />
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2Icon className="animate-spin" />}
          {editing ? "Save changes" : "Create account"}
        </Button>
      </div>
    </Form>
  );
}

/**
 * A password the admin has to be able to read back to someone. It is shown by
 * default rather than dotted out: it is being set, not being entered, and an
 * admin who cannot see what they are about to hand over will mistype it.
 */
export function PasswordField({
  value,
  onChange,
  name = "password",
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  name?: string;
  autoFocus?: boolean;
}) {
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast.error("The browser blocked the clipboard. Select it and copy by hand.");
    }
  };

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Input
          name={name}
          type={hidden ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          required
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
          autoComplete="new-password"
          spellCheck={false}
          className="pr-9 font-mono"
        />
        <button
          type="button"
          onClick={() => setHidden((h) => !h)}
          aria-label={hidden ? "Show the password" : "Hide the password"}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {hidden ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
        </button>
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => onChange(suggestPassword())}
        aria-label="Suggest a password"
        title="Suggest a password"
      >
        <ShuffleIcon />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={copy}
        disabled={!value}
        aria-label="Copy the password"
        title="Copy the password"
      >
        {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
      </Button>
    </div>
  );
}

/**
 * Setting someone else's password. The admin reads it out or writes it down, so
 * the field is legible rather than dotted, and the dialog says plainly that the
 * staffer is signed out the moment it is saved.
 */
export function ResetPasswordDialog({
  open,
  onOpenChange,
  name,
  userId,
  fetcher,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  userId: string;
  fetcher: ReturnType<typeof useFetcher<StaffActionResult>>;
}) {
  const [password, setPassword] = useState("");
  const issue = checkPassword(password);
  const busy = fetcher.state !== "idle";

  // A fresh box every time it opens — a password left lying in state is one
  // that could be sent to the wrong person on the next open.
  useEffect(() => {
    if (open) setPassword("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset the password for {name}</DialogTitle>
          <DialogDescription>
            This signs them out everywhere. Give them the new password in
            person — nothing is sent to them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            New password
          </Label>
          <PasswordField value={password} onChange={setPassword} name="ignored" autoFocus />
          {issue && <p className="text-xs text-destructive">{issue}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!password || Boolean(issue) || busy}
            onClick={() =>
              fetcher.submit(
                { intent: "reset-password", userId, newPassword: password },
                { method: "post" },
              )
            }
          >
            {busy && <Loader2Icon className="animate-spin" />}
            Reset password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The role, as a quiet badge. Admin carries the only colour — it is the one
    role that can change everyone else's access. */
export function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        role === "admin"
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground",
      )}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

export function StatusPill({ status }: { status: ResolvedStatus }) {
  if (status === "unknown") {
    return (
      <span
        className="text-sm text-muted-foreground"
        title="Too many disabled accounts to resolve on this tab. Open Active or Disabled to be sure."
      >
        —
      </span>
    );
  }
  const active = status === "active";
  return (
    <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          active ? "bg-success" : "bg-muted-foreground/50",
        )}
      />
      <span className={active ? "text-foreground" : "text-muted-foreground"}>
        {active ? "Active" : "Disabled"}
      </span>
    </span>
  );
}

function ValidationIssues({ details }: { details?: unknown }) {
  if (!Array.isArray(details) || details.length === 0) return null;
  return (
    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-destructive/90">
      {details.slice(0, 8).map((issue, i) => {
        const msg =
          issue && typeof issue === "object" && "message" in issue
            ? String((issue as { message: unknown }).message)
            : String(issue);
        return <li key={i}>{msg}</li>;
      })}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-4 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Fld({
  label,
  required,
  hint,
  issue,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  /** A failed pre-check. Replaces the hint and reads as an error. */
  issue?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {issue ? (
        <p className="text-xs text-destructive">{issue}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
