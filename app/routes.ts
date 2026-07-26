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

    // Susu. An account belongs to a customer, so there is no `susu/new` — a
    // cycle is opened from the customer's own page, where the person it
    // belongs to is on screen.
    route("susu", "routes/susu.tsx"),
    route("susu/:id", "routes/susu-account.tsx"),
    // The field flow: one cash amount split across everything a customer is
    // saving into. Its own URL rather than a tab on the susu list — it is the
    // screen a collector opens first and returns to all day.
    route("collections", "routes/collections.tsx"),

    route("staff", "routes/staff.tsx"),
  ]),
] satisfies RouteConfig;
