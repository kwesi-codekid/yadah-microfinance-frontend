import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("login/verify", "routes/verify-otp.tsx"),
  route("logout", "routes/logout.tsx"),
  route("change-password", "routes/change-password.tsx"),

  layout("routes/app-layout.tsx", [
    route("dashboard", "routes/dashboard.tsx"),
    route("customers", "routes/customers.tsx"),
    route("customers/new", "routes/customer-new.tsx"),
    route("customers/:id", "routes/customer-detail.tsx"),
    route("customers/:id/accounts", "routes/customer-accounts.tsx"),
    route("customers/:id/loans", "routes/customer-loans.tsx"),

    route("susu", "routes/susu.tsx"),
    route("susu/:id", "routes/susu-account.tsx"),
    route("savings", "routes/savings.tsx"),
    route("savings/:id", "routes/savings-account.tsx"),

    route("loans", "routes/loans.tsx"),
    route("loans/config", "routes/loan-config.tsx"),
    route("loans/:id", "routes/loan-detail.tsx"),

    route("staff", "routes/staff.tsx"),
  ]),
] satisfies RouteConfig;
