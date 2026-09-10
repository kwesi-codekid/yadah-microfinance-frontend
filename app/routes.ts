import {
  index,
  layout,
  route,
  type RouteConfig,
} from "@react-router/dev/routes";

export default [
  // The splash decides where you belong and sends you there.
  index("routes/splash.tsx"),

  /* Signed out. */
  route("login", "routes/login.tsx"),
  route("login/verify", "routes/login-verify.tsx"),
  route("forgot-password", "routes/forgot-password.tsx"),
  route("reset-password", "routes/reset-password.tsx"),
  route("logout", "routes/logout.tsx"),

  /* Signed in. The layout loader is the gate: everything nested behind it
     requires a session, and each module re-checks the role it needs. */
  layout("routes/app-layout.tsx", [
    route("dashboard", "routes/dashboard.tsx"),
    // Reassigning from a row is an errand, not a destination: it opens as a
    // drawer over the rows, so the list — and the filters that found the
    // customer — are still there when it closes. The same errand over the
    // customer's own page is nested under `customers/:id` below; two routes
    // because a route sits under one parent only, and the page underneath a
    // drawer has to be the page it was opened from. They differ in one more
    // way that matters: this one carries no loader, so opening it goes nowhere
    // near the server.
    route("customers", "routes/customers.tsx", [
      route(":id/reassign", "routes/customers-reassign.tsx"),
    ]),
    route("customers/new", "routes/customer-new.tsx"),
    // Bulk registration from a spreadsheet: check the sheet, correct what it
    // flags, then write. The template is a sibling — a download should not run
    // the page's own work to answer it.
    route("customers/import", "routes/customer-import.tsx"),
    route("customers/import/template", "routes/customer-import-template.tsx"),
    // Resource routes: they proxy a binary body from the API, which the
    // browser cannot fetch itself because it holds no access token.
    route("customers/export", "routes/customers-export.tsx"),
    route("customers/:id", "routes/customer-detail.tsx", [
      // Admin-only, and the only way `assignedCollectorId` ever changes — a
      // profile update ignores the field.
      route("collector", "routes/customer-collector.tsx"),
    ]),
    route("customers/:id/edit", "routes/customer-edit.tsx"),
    route("customers/:id/statement", "routes/customer-statement.tsx"),
    route("customers/:id/statement/export", "routes/customer-statement-export.tsx"),
    route("customers/:id/registration-form", "routes/customer-print.tsx"),
    route("uploads", "routes/uploads.tsx"),
    // JSON resource route behind the session, so a picker in the browser can
    // look customers up without holding an access token of its own.
    route("customers/search", "routes/customer-search.tsx"),

    /* Susu. The book is a page; opening an account and taking a collection are
       errands, so they are children of it and render as drawers over the rows.
       The account itself is a page — a cycle, its figures and its statement do
       not fit a drawer — with the deposit drawer nested in turn. */
    route("susu/export", "routes/susu-export.tsx"),
    route("susu/summary", "routes/susu-summary.tsx"),
    route("susu", "routes/susu.tsx", [
      route("new", "routes/susu-new.tsx"),
      route("collect", "routes/susu-collect.tsx"),
    ]),
    route("susu/:id/deposits/export", "routes/susu-deposits-export.tsx"),
    // Resource routes: they proxy a PDF from the API, which the browser cannot
    // fetch itself because it holds no access token.
    route(
      "susu/:id/deposits/:depositId/receipt",
      "routes/susu-deposit-receipt.tsx",
    ),
    route(
      "susu/:id/withdrawals/:payoutId/receipt",
      "routes/susu-withdrawal-receipt.tsx",
    ),
    route("susu/:id", "routes/susu-detail.tsx", [
      route("deposit", "routes/susu-deposit.tsx"),
      route("withdraw", "routes/susu-withdraw.tsx"),
      route("charge", "routes/susu-charge.tsx"),
    ]),
    /* Savings. Same shape as susu: the book is a page, opening an account is an
       errand and renders as a drawer over the rows. The account itself is a
       page — a balance, what may leave it today and an open-ended statement do
       not fit a drawer — with the deposit and withdrawal drawers nested in it. */
    route("savings/export", "routes/savings-export.tsx"),
    route("savings", "routes/savings.tsx", [
      route("new", "routes/savings-new.tsx"),
    ]),
    route(
      "savings/:id/transactions/export",
      "routes/savings-transactions-export.tsx",
    ),
    route("savings/:id/txns/:txnId/receipt", "routes/savings-txn-receipt.tsx"),
    route("savings/:id", "routes/savings-detail.tsx", [
      route("deposit", "routes/savings-deposit.tsx"),
      route("withdraw", "routes/savings-withdraw.tsx"),
      route("charge", "routes/savings-charge.tsx"),
    ]),
    /* The ledger. Its export is a sibling rather than a child: nesting would
       run the ledger's own query to answer a download. */
    route("transactions/export", "routes/transactions-export.tsx"),
    route("transactions", "routes/transactions.tsx"),

    /* Transfers. One endpoint, so there is no book to list — a transfer shows
       up in the ledger above as its per-module legs. What it needs instead is
       room to explain itself before it is sent, so it is a page of its own. */
    route("transfers", "routes/transfers.tsx"),
    // Proof of the move: both legs named on one sheet.
    route("transfers/:id/receipt", "routes/transfer-receipt.tsx"),

    /* A mobile-money charge, followed until it settles. There is no listing:
       the API addresses a charge only by its reference, so this is reached from
       the drawer that opened it and from the toast that drawer leaves behind. */
    route("payments/charges/:reference", "routes/payment-charge.tsx"),

    /* Reports. The questions that cut across more than one module, so none of
       them belongs on a module's own screen. Each export is a sibling of its
       report rather than a child — nesting would run the report's queries just
       to answer a download. */
    route("reports", "routes/reports.tsx"),
    route("reports/collections/export", "routes/report-collections-export.tsx"),
    route("reports/collections", "routes/report-collections.tsx"),
    route("reports/loans/aging/export", "routes/report-aging-export.tsx"),
    route("reports/loans/export", "routes/report-loans-export.tsx"),
    route("reports/loans", "routes/report-loans.tsx"),
    route("reports/commission/export", "routes/report-commission-export.tsx"),
    route("reports/commission", "routes/report-commission.tsx"),
    // Not a report on the business but on the machine running it: whether the
    // background workers are alive. Admin only.
    route("reports/workers", "routes/report-workers.tsx"),

    /* Accounting — the company's own books, as opposed to its customers'.
       The cash position is the front page, with the accounts it is read off
       and the door into each book. Expenses, the asset register and capital
       are listings, and recording into one is an errand that opens as a drawer
       over it. The two statements are pages of their own: a balance sheet does
       not fit a card. The pages share a layout with the books down the left;
       every export stays outside it, a sibling of what it exports — nesting
       would run the page's own queries just to answer a download. */
    route("accounting/expenses/export", "routes/accounting-expenses-export.tsx"),
    route("accounting/assets/export", "routes/accounting-assets-export.tsx"),
    route(
      "accounting/balance-sheet/export",
      "routes/accounting-balance-sheet-export.tsx",
    ),
    route(
      "accounting/profit-loss/export",
      "routes/accounting-profit-loss-export.tsx",
    ),
    layout("routes/accounting-layout.tsx", [
      route("accounting", "routes/accounting.tsx", [
        route("accounts/new", "routes/accounting-account-new.tsx"),
      ]),
      route("accounting/expenses", "routes/accounting-expenses.tsx", [
        route("new", "routes/accounting-expense-new.tsx"),
      ]),
      route("accounting/assets", "routes/accounting-assets.tsx", [
        route("new", "routes/accounting-asset-new.tsx"),
      ]),
      route("accounting/capital", "routes/accounting-capital.tsx", [
        route("new", "routes/accounting-capital-new.tsx"),
      ]),
      route("accounting/balance-sheet", "routes/accounting-balance-sheet.tsx"),
      route("accounting/profit-loss", "routes/accounting-profit-loss.tsx"),
    ]),

    /* Loans. The book is a page; applying is an errand and renders as a drawer
       over the rows. A loan itself is a page — an eligibility summary, a
       schedule and a repayment history do not fit a drawer — with the
       repayment drawers nested in it. */
    route("loans/export", "routes/loans-export.tsx"),
    // JSON resource route behind the session, so the application form can read
    // a customer's history as soon as they are picked, without a token of its
    // own and without navigating away from the half-filled form.
    route("loans/eligibility/:customerId", "routes/loan-eligibility.tsx"),
    route("loans", "routes/loans.tsx", [
      route("new", "routes/loan-new.tsx"),
      // The parameters new lending runs on. A drawer over the book, office only.
      route("config", "routes/loan-config.tsx"),
    ]),
    // Resource routes: they proxy a PDF from the API, which the browser cannot
    // fetch itself because it holds no access token.
    route("loans/:id/disbursement/receipt", "routes/loan-disbursement-receipt.tsx"),
    route(
      "loans/:id/repayments/:repaymentId/receipt",
      "routes/loan-repayment-receipt.tsx",
    ),
    route("loans/:id", "routes/loan-detail.tsx", [
      route("repay", "routes/loan-repay.tsx"),
      route("repay/susu", "routes/loan-repay-susu.tsx"),
      route("charge", "routes/loan-charge.tsx"),
    ]),

    /* Hire purchase, in two halves. The shelf and the contracts written against
       it are separate books with separate rows, so they are separate pages. */
    route("hire-purchase/export", "routes/hire-purchase-export.tsx"),
    // JSON resource route behind the session, so the signing form can check the
    // conditions the moment a customer is picked.
    route("hire-purchase/eligibility/:customerId", "routes/hp-eligibility.tsx"),
    route("hire-purchase", "routes/hire-purchase.tsx", [
      route("new", "routes/hp-new.tsx"),
      // The interest rate new agreements snapshot. A drawer over the book, admin only.
      route("config", "routes/hp-config.tsx"),
    ]),
    route(
      "hire-purchase/:id/payments/:paymentId/receipt",
      "routes/hp-payment-receipt.tsx",
    ),
    route("hire-purchase/:id", "routes/hp-detail.tsx", [
      route("pay", "routes/hp-pay.tsx"),
      route("charge", "routes/hp-charge.tsx"),
    ]),

    /* Cash handover. The one module both halves of the business touch: a
       collector declares, the office counts, and the gap is recorded rather
       than argued about. Declaring is an errand over the book and renders as a
       drawer; a day itself is a page, because the three figures and the count
       form do not fit one. The exports are siblings — nesting would run the
       book's queries to answer a download. */
    route("reconciliation/export", "routes/reconciliation-export.tsx"),
    route(
      "reconciliation/variances/export",
      "routes/reconciliation-variances-export.tsx",
    ),
    route("reconciliation", "routes/reconciliation.tsx", [
      route("declare", "routes/reconciliation-declare.tsx"),
    ]),
    route("reconciliation/:id", "routes/reconciliation-detail.tsx"),

    /* Payout requests. Withdrawals the customer asked for from the portal,
       waiting on the office. The queue is a page; a request is a page too —
       the decision deserves room, and after approval the page watches the
       transfer until Paystack answers. */
    route("payout-requests", "routes/payout-requests.tsx"),
    route("payout-requests/:id", "routes/payout-request-detail.tsx"),

    /* Counter sales, in two halves. The till is the POS: a destination of its
       own rather than an errand over the listing, because a basket, a buyer and
       a total need room and because it is where someone stands for a minute. It
       sits outside `/sales` so the rail can light one or the other — a path
       under the listing would light both. `/sales` is then the day book: every
       sale rung up, with its receipt and its voids. The export and the receipt
       are resource routes, so they sit outside the listing that links to them. */
    route("pos", "routes/pos.tsx"),
    route("sales/export", "routes/sales-export.tsx"),
    route("sales/:id/receipt", "routes/sale-receipt.tsx"),
    route("sales/:id", "routes/sale-detail.tsx"),
    route("sales", "routes/sales.tsx"),

    route("inventory/export", "routes/inventory-export.tsx"),
    // Stocking the shelf from a spreadsheet: check the sheet, correct what it
    // flags, then write. The template is a sibling — a download should not run
    // the page's own work to answer it.
    route("inventory/import", "routes/inventory-import.tsx"),
    route("inventory/import/template", "routes/inventory-import-template.tsx"),
    /* The shelf and the two lists it is filed under, behind one rail. The
       add and rename drawers are children of the page they open over. */
    layout("routes/inventory-layout.tsx", [
      route("inventory", "routes/inventory.tsx", [
        route("new", "routes/inventory-new.tsx"),
        route(":id/edit", "routes/inventory-edit.tsx"),
        route(":id/stock", "routes/inventory-stock.tsx"),
      ]),
      route("inventory/brands", "routes/inventory-brands.tsx", [
        route("new", "routes/inventory-brand-new.tsx"),
      ]),
      route("inventory/brands/:id", "routes/inventory-brand.tsx", [
        route("edit", "routes/inventory-brand-edit.tsx"),
      ]),
      route("inventory/categories", "routes/inventory-categories.tsx", [
        route("new", "routes/inventory-category-new.tsx"),
      ]),
      route("inventory/categories/:id", "routes/inventory-category.tsx", [
        route("edit", "routes/inventory-category-edit.tsx"),
      ]),
    ]),
    // Resource route: it proxies a binary body from the API, which the browser
    // cannot fetch itself because it holds no access token. A sibling of the
    // listing rather than a child of it — nesting would run the listing's three
    // queries to answer a download.
    route("staff/export", "routes/staff-export.tsx"),
    // Adding, editing and reading a staff account are children of the listing:
    // each renders into a drawer over it, so the rows and the filters stay put
    // underneath. They remain real routes — addressable, and gated by their own
    // loaders — rather than state held in the listing.
    route("staff", "routes/staff.tsx", [
      route("new", "routes/staff-new.tsx"),
      route(":id", "routes/staff-detail.tsx"),
      route(":id/edit", "routes/staff-edit.tsx"),
      route(":id/round", "routes/staff-round.tsx"),
    ]),
    /* Every role, and strictly the reader's own: the API has no way to ask for
       somebody else's, so there is no scoping to do here. */
    route("notifications", "routes/notifications.tsx"),
    /* The trash, one book per list that trashes into it, behind the same rail
       the accounting module draws its books in. Each book is its own route
       with its own query; the layout only supplies the rail. */
    layout("routes/trash-layout.tsx", [
      route("trash", "routes/trash.tsx"),
      route("trash/susu", "routes/trash-susu.tsx"),
      route("trash/savings", "routes/trash-savings.tsx"),
      route("trash/loans", "routes/trash-loans.tsx"),
      route("trash/inventory", "routes/trash-inventory.tsx"),
      route("trash/agreements", "routes/trash-agreements.tsx"),
    ]),
    route("change-password", "routes/change-password.tsx"),
  ]),

  /* The customer portal. A separate product on the same host: its own OTP
     login, its own session cookie scoped to /portal, and a lighter frame —
     tabs under a header, no rail. Nothing under it can be reached with a
     staff session, and nothing above it with a customer one. */
  route("portal/login", "routes/portal-login.tsx"),
  route("portal/login/verify", "routes/portal-login-verify.tsx"),
  route("portal/logout", "routes/portal-logout.tsx"),
  layout("routes/portal-layout.tsx", [
    route("portal", "routes/portal-home.tsx"),
    route("portal/transactions", "routes/portal-transactions.tsx"),
    route("portal/statement", "routes/portal-statement.tsx"),
    route("portal/pay", "routes/portal-pay.tsx"),
    route("portal/pay/:reference", "routes/portal-charge.tsx"),
    route("portal/requests", "routes/portal-requests.tsx"),
    route("portal/requests/new", "routes/portal-request-new.tsx"),
  ]),

  /* Outside the layout on purpose: a document, not a screen. Everything on the
     page is meant to end up on the paper, so it carries no sidebar or rail.
     Its own loader is the gate — being outside the layout is not being outside
     the session. */
  route("customers/:id/advice/:txId", "routes/transaction-advice.tsx"),
] satisfies RouteConfig;
