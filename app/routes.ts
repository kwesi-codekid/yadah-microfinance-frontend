import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),

  // Authenticated app shell (sidebar + top bar). Every page nested here is
  // behind the layout's requireUser loader.
  layout("routes/app-layout.tsx", [
    route("dashboard", "routes/dashboard.tsx"),
    route("customers", "routes/customers.tsx"),
    // Static before dynamic isn't required — React Router ranks `new` above
    // `:id` on specificity — but it reads in the order you meet them.
    route("customers/new", "routes/customer-new.tsx"),
    // No `customers/:id/edit`: editing happens in place on the record itself,
    // behind `?edit`, so the fields turn into inputs where they already sit.
    route("customers/:id", "routes/customer-detail.tsx"),
    // Everything a customer is saving into. An account belongs to a customer,
    // so this is also where one is opened — there is no `susu/new`.
    route("customers/:id/accounts", "routes/customer-accounts.tsx"),

    // One account, with its statement. Kept off `customers/:id/accounts/...`
    // deliberately: susu deposits and (later) savings withdrawals are
    // different shapes, so each product keeps its own detail route and every
    // account has exactly one address. There is no cross-customer list above
    // it — accounts are reached through the customer who holds them.
    route("susu/:id", "routes/susu-account.tsx"),
    // The field flow: one cash amount split across everything a customer is
    // saving into. Its own URL rather than a tab on the susu list — it is the
    // screen a collector opens first and returns to all day.
    route("collections", "routes/collections.tsx"),

    route("staff", "routes/staff.tsx"),
  ]),
] satisfies RouteConfig;
