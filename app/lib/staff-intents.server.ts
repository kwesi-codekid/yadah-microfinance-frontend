import * as usersApi from "~/lib/api/users";
import { isRole, type Role } from "~/lib/auth-client";
import { validatePhone, validateUsername } from "~/lib/validation";

export type StaffActionData = {
  ok?: boolean;
  intent?: string;
  message?: string;
  formError?: string;
  fieldErrors?: Record<string, string>;
};

/** Validate and perform one staff mutation. Throws `ApiError` on rejection. */
export async function runStaffIntent({
  token,
  intent,
  id,
  form,
}: {
  token: string;
  intent: string;
  id: string;
  form: FormData;
}): Promise<StaffActionData> {
  if (intent === "create") {
    const input = {
      name: String(form.get("name") ?? "").trim(),
      username: String(form.get("username") ?? "").trim(),
      phone: String(form.get("phone") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      role: String(form.get("role") ?? ""),
      password: String(form.get("password") ?? ""),
    };
    const fieldErrors: Record<string, string> = {};
    if (input.name.length < 2 || input.name.length > 100)
      fieldErrors.name = "Name must be 2–100 characters.";
    const u = validateUsername(input.username);
    if (u) fieldErrors.username = u;
    const p = validatePhone(input.phone);
    if (p) fieldErrors.phone = p;
    if (!isRole(input.role)) fieldErrors.role = "Choose a role.";
    if (input.password.length < 8 || input.password.length > 128)
      fieldErrors.password = "Password must be 8–128 characters.";
    if (Object.keys(fieldErrors).length)
      return { intent, fieldErrors } satisfies StaffActionData;

    const { user: created } = await usersApi.createUser(token, {
      name: input.name,
      username: input.username,
      phone: input.phone,
      email: input.email || undefined,
      role: input.role as Role,
      password: input.password,
    });

    try {
      await usersApi.resetUserPassword(token, created.id, {
        newPassword: input.password,
        mustChangePassword: true,
      });
    } catch {
      return {
        ok: true,
        intent,
        message: `${input.name} added, but they won't be asked to change this password. Use Reset password to require it.`,
      } satisfies StaffActionData;
    }

    return {
      ok: true,
      intent,
      message: `${input.name} added. They'll set their own password at first sign-in.`,
    } satisfies StaffActionData;
  }

  if (intent === "update") {
    const name = String(form.get("name") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const role = String(form.get("role") ?? "");
    const fieldErrors: Record<string, string> = {};
    if (name.length < 2 || name.length > 100)
      fieldErrors.name = "Name must be 2–100 characters.";
    const p = validatePhone(phone);
    if (p) fieldErrors.phone = p;
    if (!isRole(role)) fieldErrors.role = "Choose a role.";
    if (Object.keys(fieldErrors).length)
      return { intent, fieldErrors } satisfies StaffActionData;

    await usersApi.updateUser(token, id, {
      name,
      phone,
      email: email || undefined,
      role: role as Role,
    });
    return { ok: true, intent, message: "Staff updated." } satisfies StaffActionData;
  }

  if (intent === "reset-password") {
    const newPassword = String(form.get("newPassword") ?? "");
    const mustChangePassword = form.get("mustChangePassword") === "on";
    if (newPassword.length < 8 || newPassword.length > 128)
      return {
        intent,
        fieldErrors: { newPassword: "Password must be 8–128 characters." },
      } satisfies StaffActionData;
    await usersApi.resetUserPassword(token, id, {
      newPassword,
      mustChangePassword,
    });
    return { ok: true, intent, message: "Password reset." } satisfies StaffActionData;
  }

  if (intent === "disable") {
    await usersApi.disableUser(token, id);
    return { ok: true, intent, message: "Staff disabled." } satisfies StaffActionData;
  }

  if (intent === "enable") {
    await usersApi.enableUser(token, id);
    return { ok: true, intent, message: "Staff enabled." } satisfies StaffActionData;
  }

  return { formError: "Unsupported action." } satisfies StaffActionData;
}
