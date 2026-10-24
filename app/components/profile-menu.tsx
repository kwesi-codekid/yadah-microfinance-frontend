import { useTheme } from "next-themes";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Form, Link } from "react-router";

import { InstallInstructions, useInstallApp } from "~/components/install-app";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { initialsOf, ROLE_LABELS, type AuthUser } from "~/lib/auth";
import { cn } from "~/lib/utils";

const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match device" },
] as const;

/** One menu row: roomy, plain text, a soft glass highlight on hover. */
const ROW =
  "flex cursor-pointer items-center rounded-lg px-3 py-2.5 text-sm outline-none select-none focus:bg-black/[0.06] data-[highlighted]:bg-black/[0.06] dark:focus:bg-white/10 dark:data-[highlighted]:bg-white/10";

/** Who is signed in, and the two things they can do about it.
 *  `compact` drops the name block — the avatar alone is the trigger, for
 *  headers drawn to the dashboard reference where only the circle appears. */
export function ProfileMenu({
  user,
  compact = false,
  triggerClassName,
}: {
  user: AuthUser;
  compact?: boolean;
  /** Restyles the compact trigger — the header gives it the glass bead. */
  triggerClassName?: string;
}) {
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [showingInstall, setShowingInstall] = useState(false);
  const [open, setOpen] = useState(false);
  const install = useInstallApp();
  const { theme = "system", setTheme } = useTheme();

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {/* The page frosts behind the open menu, as it does behind the search. */}
      {open &&
        createPortal(
          <div
            aria-hidden
            className="fixed inset-0 z-40 animate-in bg-black/10 backdrop-blur-sm duration-150 fade-in-0"
          />,
          document.body,
        )}
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            compact ? "size-9 rounded-full p-0" : "h-9 gap-2 pr-2 pl-1.5",
            compact && triggerClassName,
          )}
          aria-label="Account menu"
        >
          {/* Inside a glass bead the avatar sits a size smaller, so the rim shows. */}
          <Avatar className={compact ? (triggerClassName ? "size-7" : "size-9") : "size-7"}>
            <AvatarFallback
              className="text-xs font-semibold"
              style={{ background: "var(--tint-1-bg)", color: "var(--tint-1-fg)" }}
            >
              {initialsOf(user.name)}
            </AvatarFallback>
          </Avatar>
          {!compact && (
            <span className="hidden text-left sm:flex sm:flex-col sm:gap-0.5">
              <span className="text-sm leading-none font-medium">{user.name}</span>
              <span className="text-[0.7rem] leading-none text-muted-foreground">
                {ROLE_LABELS[user.role]}
              </span>
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      {/* Frosted glass, after the sign-in page: a bright rim and a soft lift. */}
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-64 rounded-xl border border-white/70 bg-white/45 p-1.5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.8)] ring-0 backdrop-blur-md backdrop-saturate-150 dark:border-white/10 dark:bg-neutral-900/45 dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.06)]"
      >
        <div className="px-3 pt-2 pb-2.5">
          <p className="truncate text-sm font-semibold">{user.name}</p>
          <p className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="truncate font-medium">{ROLE_LABELS[user.role]}</span>
            <span className="shrink-0 tabular-nums">{user.phone}</span>
          </p>
        </div>

        <DropdownMenuItem asChild className={ROW}>
          <Link to="/change-password">Change password</Link>
        </DropdownMenuItem>

        {install.offered && (
          <DropdownMenuItem
            className={ROW}
            onSelect={(event) => {
              // Directions need the dialog to outlive the menu; the prompt is
              // the browser's own window, so that one can let the menu close.
              if (install.manual) {
                event.preventDefault();
                setShowingInstall(true);
                return;
              }
              void install.install();
            }}
          >
            Install app
          </DropdownMenuItem>
        )}

        <p className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
          Appearance
        </p>
        <DropdownMenuPrimitive.RadioGroup value={theme} onValueChange={setTheme}>
          {THEMES.map(({ value, label }) => (
            <DropdownMenuPrimitive.RadioItem
              key={value}
              value={value}
              // Picking a theme keeps the menu open, so the change can be seen.
              onSelect={(event) => event.preventDefault()}
              className={cn(ROW, "relative pl-8")}
            >
              <span className="absolute left-3 flex size-2.5 items-center justify-center">
                <DropdownMenuPrimitive.ItemIndicator>
                  <span className="block size-1.5 rounded-full bg-foreground" />
                </DropdownMenuPrimitive.ItemIndicator>
              </span>
              {label}
            </DropdownMenuPrimitive.RadioItem>
          ))}
        </DropdownMenuPrimitive.RadioGroup>

        <div className="mx-2 my-1.5 h-px bg-black/10 dark:bg-white/10" />

        <DropdownMenuItem
          className={cn(ROW, "text-destructive focus:text-destructive")}
          // Keep the menu's focus from closing the dialog we're about to open.
          onSelect={(event) => {
            event.preventDefault();
            setConfirmingSignOut(true);
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>

      <InstallInstructions open={showingInstall} onOpenChange={setShowingInstall} />

      <AlertDialog
        open={confirmingSignOut}
        onOpenChange={setConfirmingSignOut}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll need to sign in again to get back to your dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/* A POST, so a prefetch or a crawler can never sign anyone out. */}
            <Form method="post" action="/logout" className="contents">
              <AlertDialogAction type="submit" variant="destructive">
                Sign out
              </AlertDialogAction>
            </Form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DropdownMenu>
  );
}
