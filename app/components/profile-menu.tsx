import { DownloadIcon, KeyRoundIcon, LogOutIcon } from "lucide-react";
import { useState } from "react";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { initialsOf, ROLE_LABELS, type AuthUser } from "~/lib/auth";

/** Who is signed in, and the two things they can do about it.
 *  `compact` drops the name block — the avatar alone is the trigger, for
 *  headers drawn to the dashboard reference where only the circle appears. */
export function ProfileMenu({
  user,
  compact = false,
}: {
  user: AuthUser;
  compact?: boolean;
}) {
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [showingInstall, setShowingInstall] = useState(false);
  const install = useInstallApp();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={compact ? "size-9 rounded-full p-0" : "h-9 gap-2 pr-2 pl-1.5"}
          aria-label="Account menu"
        >
          <Avatar className={compact ? "size-9" : "size-7"}>
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

      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            @{user.username} · {ROLE_LABELS[user.role]}
          </p>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link to="/change-password">
            <KeyRoundIcon />
            Change password
          </Link>
        </DropdownMenuItem>

        {install.offered && (
          <DropdownMenuItem
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
            <DownloadIcon />
            Install app
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          // Keep the menu's focus from closing the dialog we're about to open.
          onSelect={(event) => {
            event.preventDefault();
            setConfirmingSignOut(true);
          }}
        >
          <LogOutIcon />
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
