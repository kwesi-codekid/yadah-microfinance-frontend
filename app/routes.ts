import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  // Step two of phone sign-in. Its own page, not a phase of /login: it is
  // reachable only while a code is in flight (`pendingOtpPhone` in the session
  // cookie), and `VERIFY_OTP_PATH` in session.server.ts has to match this path.
  route("login/verify", "routes/verify-otp.tsx"),
  route("logout", "routes/logout.tsx"),
  // Outside the app shell on purpose. Reached voluntarily from the sidebar, or
  // forced by `mustChangePassword` — and when it's forced every other route
  // redirects back to it, so a sidebar here would be nothing but dead links.
  // Its path is `CHANGE_PASSWORD_PATH` in session.server.ts, which is what the
  // guard redirects to; the two have to agree.
  route("change-password", "routes/change-password.tsx"),

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
    // A loan belongs to a customer the same way an account does, so this is
    // also where one is applied for — there is no `loans/new`. What it adds
    // over the accounts page is the eligibility summary, which the API
    // publishes precisely because the approval decision is a person's.
    route("customers/:id/loans", "routes/customer-loans.tsx"),

    // One account, with its statement. Kept off `customers/:id/accounts/...`
    // deliberately: susu deposits and (later) savings withdrawals are
    // different shapes, so each product keeps its own detail route and every
    // account has exactly one address. There is no cross-customer list above
    // it — accounts are reached through the customer who holds them.
    route("susu/:id", "routes/susu-account.tsx"),
    // Savings sits beside susu for the same reason: one address per account,
    // and the two products' detail pages are different shapes — a cycle of 31
    // days against an open-ended balance with a fee on the way out.
    route("savings/:id", "routes/savings-account.tsx"),

    // Loans get the cross-customer list that susu and savings deliberately
    // don't. The difference is in the API and in the workflow: `GET /loans`
    // takes a `search` and joins the customer's name, and a **pending
    // application has to be found by whoever approves it** — who has no reason
    // to have opened that customer's record first. A queue nobody can see is a
    // queue nobody works.
    route("loans", "routes/loans.tsx"),
    // Before `loans/:id` for reading order only — React Router ranks the
    // static segment above the dynamic one regardless.
    route("loans/config", "routes/loan-config.tsx"),
    route("loans/:id", "routes/loan-detail.tsx"),

    route("staff", "routes/staff.tsx"),
  ]),
] satisfies RouteConfig;
