import * as customersApi from "~/lib/api/customers";
import type { CustomerMatch } from "~/lib/customer-search";

/**
 * Resolves a `?open=<id>` handoff into the shape the picker shows. Null when
 * the id is stale or the customer can no longer hold an account — the drawer
 * then opens empty rather than failing on submit.
 */
export async function pickedCustomer(
  accessToken: string,
  id: string,
): Promise<CustomerMatch | null> {
  try {
    const { customer } = await customersApi.getCustomer(accessToken, id);
    if (customer.status !== "active") return null;
    return {
      id: customer.id,
      fullName: customer.fullName,
      phone: customer.phone,
    };
  } catch {
    return null;
  }
}
