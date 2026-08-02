/**
 * Paging helpers for the susu and savings account lists.
 *
 * The API's `accountNumber` filter is an exact match, but staff type the first
 * few digits off a passbook. So when digits are present we read several pages
 * and narrow them here instead.
 */

/** Page size while scanning. The API's own ceiling. */
export const SCAN_LIMIT = 100;

/** How many pages a scan reads before it gives up and reports `truncated`. */
export const SCAN_MAX_PAGES = 5;

export async function scanAccounts<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; total: number }>,
  maxPages = SCAN_MAX_PAGES,
): Promise<{ items: T[]; truncated: boolean }> {
  const first = await fetchPage(1);
  const pages = Math.min(maxPages, Math.ceil(first.total / SCAN_LIMIT));
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => fetchPage(i + 2)),
  );
  const items = [first.items, ...rest.map((r) => r.items)].flat();
  return { items, truncated: items.length < first.total };
}

/** Substring match on the number, with prefix hits sorted to the top. */
export function matchNumber<T extends { accountNumber: string }>(
  items: T[],
  typed: string,
): T[] {
  return items
    .filter((item) => item.accountNumber.includes(typed))
    .sort((a, b) => {
      const byPrefix =
        Number(b.accountNumber.startsWith(typed)) -
        Number(a.accountNumber.startsWith(typed));
      return byPrefix || a.accountNumber.localeCompare(b.accountNumber);
    });
}

/** Slice a scanned list into the shape the API would have returned. */
export function pageOf<T>(items: T[], page: number, limit: number) {
  const last = Math.max(1, Math.ceil(items.length / limit));
  const current = Math.min(page, last);
  return {
    items: items.slice((current - 1) * limit, current * limit),
    page: current,
    limit,
    total: items.length,
  };
}

/** Account numbers are six digits for susu and ten for savings. */
export const ACCOUNT_NUMBER_LENGTH = { susu: 6, savings: 10 } as const;

/** Digits only, capped at the product's length. What the loaders filter on. */
export function typedDigits(
  raw: string | null,
  product: keyof typeof ACCOUNT_NUMBER_LENGTH,
): string {
  return (raw ?? "").replace(/\D/g, "").slice(0, ACCOUNT_NUMBER_LENGTH[product]);
}
