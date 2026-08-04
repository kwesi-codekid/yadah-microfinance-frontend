import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("login/verify", "routes/verify-otp.tsx"),
  route("forgot-password", "routes/forgot-password.tsx"),
  route("logout", "routes/logout.tsx"),
  route("change-password", "routes/change-password.tsx"),

  // Outside the layout: the drawers poll these, and they needn't run layout loaders.
  route("customers/search", "routes/customer-search.tsx"),
  route("loans/eligibility", "routes/loan-eligibility.tsx"),
  route("reports/download", "routes/report-download.tsx"),
  route("hire-purchase/eligibility", "routes/hp-eligibility.tsx"),
  route("transfers/destinations", "routes/transfer-destinations.tsx"),
  route("transfers/new", "routes/transfer-new.tsx"),

  layout("routes/app-layout.tsx", [
    route("dashboard", "routes/dashboard.tsx"),
    route("customers", "routes/customers.tsx"),
    route("customers/new", "routes/customer-new.tsx"),
    route("customers/:id", "routes/customer-detail.tsx"),

    route("transactions", "routes/transactions.tsx"),

    route("susu", "routes/susu.tsx"),
    route("susu/:id", "routes/susu-account.tsx"),
    route("savings", "routes/savings.tsx"),
    route("savings/:id", "routes/savings-account.tsx"),

    route("loans", "routes/loans.tsx"),
    route("loans/:id", "routes/loan-detail.tsx"),

    route("hire-purchase", "routes/hp-agreements.tsx"),
    route("hire-purchase/items", "routes/hp-items.tsx"),
    route("hire-purchase/:id", "routes/hp-agreement-detail.tsx"),

    route("reports", "routes/reports.tsx"),

    route("staff", "routes/staff.tsx"),
    route("staff/:id", "routes/staff-detail.tsx"),

    // Every setting in the app, per area, behind one tab bar.
    route("settings", "routes/settings.tsx", [
      index("routes/settings-account.tsx"),
      route("loans", "routes/loan-config.tsx"),
      route("hire-purchase", "routes/hp-config.tsx"),
    ]),

    // Where those two pages used to live.
    route("loans/config", "routes/loan-config-moved.tsx"),
    route("hire-purchase/config", "routes/hp-config-moved.tsx"),
  ]),
] satisfies RouteConfig;
