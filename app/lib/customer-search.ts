/** Below this, the search matches half the book — not worth a request. */
export const MIN_QUERY = 2;

/** One line of the customer picker. Only what it takes to tell two savers apart. */
export interface CustomerMatch {
  id: string;
  fullName: string;
  phone: string;
}
