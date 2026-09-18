import {
  BanknoteArrowUpIcon,
  CoinsIcon,
  LandmarkIcon,
  ReceiptTextIcon,
  SmartphoneIcon,
  WalletIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { data, Link } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { getAccounts } from "~/api/portal";
import { Figure, StatusPill } from "~/components/listing";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { formatAccraDate, formatCount, formatPesewas } from "~/lib/format";
import {
  SAVINGS_STATUS_LABELS,
  SUSU_STATUS_LABELS,
  isOpen,
  statusLabel,
  type PortalHirePurchase,
  type PortalLoan,
} from "~/lib/portal";
import { requireCustomer, withPortalAuth } from "~/lib/portal-session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/portal-home";

export function meta(_: Route.MetaArgs) {
  return [{ title: "My accounts · Yadah Dynamic Enterprise" }];
}

/** `GET /portal/accounts` — everything the customer holds, figures pre-derived. */
export async function loader({ request }: Route.LoaderArgs) {
  const customer = await requireCustomer(request);
  const { data: accounts, headers } = await withPortalAuth(request, async (token) => {
    try {
      return await getAccounts(token);
    } catch (error) {
      throwAsRouteError(error);
    }
  });
  return data({ customer, accounts }, { headers });
}

export default function PortalHome({ loaderData }: Route.ComponentProps) {
  const { customer, accounts } = loaderData;
  const firstName = customer.fullName.split(" ")[0];
  const openSusu = accounts.susu.filter((a) => isOpen(a.status));
  const openSavings = accounts.savings.filter((a) => isOpen(a.status));
  const closedCount =
    accounts.susu.length - openSusu.length + (accounts.savings.length - openSavings.length);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Hello, {firstName}</h1>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link to="/portal/pay" prefetch="intent">
              <SmartphoneIcon />
              Pay in
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/portal/requests/new" prefetch="intent">
              <BanknoteArrowUpIcon />
              Withdraw
            </Link>
          </Button>
        </div>
      </header>

      <dl className="grid gap-3 sm:grid-cols-2">
        <Figure
          label="Saved with us"
          value={formatPesewas(accounts.totals.saved)}
          tone="success"
          hint="Open susu and savings balances together"
        />
        <Figure
          label="Owed to us"
          value={formatPesewas(accounts.totals.owed)}
          tone={accounts.totals.owed > 0 ? "warning" : "muted"}
          hint={accounts.totals.owed > 0 ? "Open loans and hire purchase" : "Nothing outstanding"}
        />
      </dl>

      <Section title="Susu" icon={<CoinsIcon />} count={accounts.susu.length}>
        {accounts.susu.length === 0 ? (
          <EmptyLine>You have no susu account. Ask at the office to open one.</EmptyLine>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {accounts.susu.map((a) => {
              const progress = a.cycleLength > 0 ? a.depositsCount / a.cycleLength : 0;
              return (
                <li key={a.accountId} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="tabular text-xs text-muted-foreground">#{a.accountNumber}</p>
                      <p className="tabular font-heading text-2xl font-bold">{formatPesewas(a.balance)}</p>
                    </div>
                    <StatusPill
                      label={statusLabel(SUSU_STATUS_LABELS, a.status)}
                      tone={a.status === "active" ? "success" : a.status === "pending-payout" ? "warning" : "muted"}
                    />
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                      <span>
                        Day {formatCount(a.depositsCount)} of {formatCount(a.cycleLength)}
                      </span>
                      <span>{formatPesewas(a.dailyAmount)}/day</span>
                    </div>
                    <Progress value={Math.min(100, progress * 100)} aria-label="Cycle progress" />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <Cell label="Paid in" value={formatPesewas(a.totalDeposited)} />
                    <Cell label="Taken out" value={formatPesewas(a.withdrawnAmount)} />
                    <Cell label="Can take now" value={formatPesewas(a.maxPartialWithdrawal)} />
                    <Cell
                      label="If closed today"
                      value={formatPesewas(a.closurePreview.payout)}
                      hint={`after ${formatPesewas(a.closurePreview.commission)} commission`}
                    />
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Savings" icon={<WalletIcon />} count={accounts.savings.length}>
        {accounts.savings.length === 0 ? (
          <EmptyLine>You have no savings account. Ask at the office to open one.</EmptyLine>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {accounts.savings.map((a) => (
              <li key={a.accountId} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="tabular text-xs text-muted-foreground">
                      #{a.accountNumber} · {a.accountType}
                    </p>
                    <p className="tabular font-heading text-2xl font-bold">{formatPesewas(a.balance)}</p>
                  </div>
                  <StatusPill
                    label={statusLabel(SAVINGS_STATUS_LABELS, a.status)}
                    tone={a.status === "active" ? "success" : "muted"}
                  />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <Cell label="Available to withdraw" value={formatPesewas(a.available)} />
                  <Cell
                    label="Stays in the account"
                    value={formatPesewas(a.minBalance)}
                    hint={`withdrawal fee ${formatPesewas(a.withdrawalFee)}`}
                  />
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {accounts.loans.length > 0 && (
        <Section title="Loans" icon={<LandmarkIcon />} count={accounts.loans.length}>
          <ul className="grid gap-3 md:grid-cols-2">
            {accounts.loans.map((l, i) => (
              <LoanCard key={l.loanId ?? l.id ?? i} loan={l} />
            ))}
          </ul>
        </Section>
      )}

      {accounts.hirePurchase.length > 0 && (
        <Section title="Hire purchase" icon={<ReceiptTextIcon />} count={accounts.hirePurchase.length}>
          <ul className="grid gap-3 md:grid-cols-2">
            {accounts.hirePurchase.map((h, i) => (
              <HpCard key={h.agreementId ?? h.id ?? i} hp={h} />
            ))}
          </ul>
        </Section>
      )}

      {closedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {formatCount(closedCount)} closed account{closedCount === 1 ? "" : "s"} shown above for
          your records. Loans and hire purchase are paid at the office.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces --- */

function Section({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-heading text-base font-semibold [&_svg]:size-4 [&_svg]:text-muted-foreground">
        {icon}
        {title}
        {count > 0 && <span className="text-xs font-normal text-muted-foreground">· {formatCount(count)}</span>}
      </h2>
      {children}
    </section>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function Cell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
      {hint && <dd className="text-[10.5px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function LoanCard({ loan }: { loan: PortalLoan }) {
  const open = loan.status === "active" || loan.status === "disbursed" || loan.status === "overdue";
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">{loan.tier ? `${loan.tier} loan` : "Loan"}</p>
          <p className="tabular font-heading text-2xl font-bold">
            {loan.remaining != null ? formatPesewas(loan.remaining) : "—"}
          </p>
          <p className="text-xs text-muted-foreground">still to repay</p>
        </div>
        <StatusPill
          label={statusLabel({}, loan.status)}
          tone={loan.status === "overdue" ? "danger" : open ? "warning" : "muted"}
        />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        {loan.principal != null && <Cell label="Borrowed" value={formatPesewas(loan.principal)} />}
        {loan.totalRepaid != null && <Cell label="Repaid" value={formatPesewas(loan.totalRepaid)} />}
        {loan.dueDate && <Cell label="Due" value={formatAccraDate(loan.dueDate)} />}
      </dl>
    </li>
  );
}

function HpCard({ hp }: { hp: PortalHirePurchase }) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">{hp.itemName ?? "Hire purchase"}</p>
          <p className="tabular font-heading text-2xl font-bold">
            {hp.remaining != null ? formatPesewas(hp.remaining) : "—"}
          </p>
          <p className="text-xs text-muted-foreground">still to pay</p>
        </div>
        <StatusPill
          label={statusLabel({}, hp.status)}
          tone={cn(hp.status).includes("arrears") || hp.status === "repossessed" ? "danger" : hp.status === "active" ? "warning" : "muted"}
        />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        {hp.totalPaid != null && <Cell label="Paid so far" value={formatPesewas(hp.totalPaid)} />}
        {hp.totalPayable != null && <Cell label="Total" value={formatPesewas(hp.totalPayable)} />}
      </dl>
    </li>
  );
}
