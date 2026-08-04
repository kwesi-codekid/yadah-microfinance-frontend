import * as hpApi from "~/lib/api/hire-purchase";
import * as loansApi from "~/lib/api/loans";
import * as savingsApi from "~/lib/api/savings";
import * as susuApi from "~/lib/api/susu";
import { readAgreementPayload } from "~/lib/hp-client";
import { repaymentSourceLabel } from "~/lib/loan-client";
import { formatGhs } from "~/lib/money";
import type { TxnRow } from "~/lib/transactions-client";

/**
 * There is no endpoint that lists transactions across accounts, so this walks a
 * page of the account book and reads each statement. The window is what bounds
 * the work: paging moves to the next accounts, not to older transactions.
 */

/** Rows per statement. The API pages these; one page covers any real account. */
const STATEMENT_LIMIT = 100;

const UNNAMED = "Unnamed customer";

export interface BookTransactions {
  rows: TxnRow[];
  /** How many accounts this page read, across every product. */
  accountsRead: number;
  /** How many match in total, so the window can say where it sits. */
  totalAccounts: number;
  pageCount: number;
  /** Products reached, for the page to name honestly. */
  covered: string[];
}

export async function loadBookTransactions(
  token: string,
  {
    page,
    limit,
    search,
    office,
  }: { page: number; limit: number; search?: string; office: boolean },
): Promise<BookTransactions> {
  const paging = { page, limit, search };

  const [susu, savings, loans, agreements] = await Promise.all([
    susuApi.listSusuAccounts(token, paging),
    savingsApi.listSavingsAccounts(token, paging),
    // The loan and HP endpoints are office-only; a collector asking would 403.
    office ? loansApi.listLoans(token, paging) : null,
    office ? hpApi.listHpAgreements(token, paging) : null,
  ]);

  const lists = [susu, savings, loans, agreements].filter(
    (list) => list !== null,
  );
  const totalAccounts = lists.reduce((sum, list) => sum + list.total, 0);
  const pageCount = Math.max(
    1,
    ...lists.map((list) => Math.ceil(list.total / Math.max(1, list.limit))),
  );
  const accountsRead = lists.reduce((sum, list) => sum + list.items.length, 0);

  const covered = ["Susu", "Savings"];
  if (loans) covered.push("Loans");
  if (agreements) covered.push("Hire purchase");

  // Every statement on this page at once — the window is what keeps it bounded.
  const [susuStatements, savingsStatements, loanDetails, hpDetails] =
    await Promise.all([
      Promise.all(
        susu.items.map((account) =>
          susuApi
            .listSusuDeposits(token, account.id, { limit: STATEMENT_LIMIT })
            .then((result) => ({ account, items: result.items })),
        ),
      ),
      Promise.all(
        savings.items.map((account) =>
          savingsApi
            .listSavingsTxns(token, account.id, { limit: STATEMENT_LIMIT })
            .then((result) => ({ account, items: result.items })),
        ),
      ),
      Promise.all(
        (loans?.items ?? []).map((loan) =>
          loansApi
            .getLoan(token, loan.id)
            .then((detail) => ({ loan, repayments: detail.repayments ?? [] })),
        ),
      ),
      Promise.all(
        (agreements?.items ?? []).map((agreement) =>
          hpApi.getHpAgreement(token, agreement.id).then((payload) => ({
            agreement,
            payments: readAgreementPayload(payload).payments,
          })),
        ),
      ),
    ]);

  const rows: TxnRow[] = [];

  for (const { account, items } of susuStatements) {
    for (const deposit of items) {
      const days =
        deposit.daysCovered > 1 ? `${deposit.daysCovered} days` : undefined;
      rows.push({
        id: `susu-deposit:${deposit.id}`,
        kind: "susu-deposit",
        product: "susu",
        at: deposit.createdAt,
        amount: deposit.amount,
        customerName: account.customerName ?? UNNAMED,
        accountLabel: `Susu ${account.accountNumber}`,
        to: `/susu/${account.id}`,
        detail: [days, deposit.collectAllBatchId ? "batch" : undefined]
          .filter(Boolean)
          .join(" · "),
        recordedById: deposit.collectorId,
      });
    }
  }

  for (const { account, items } of savingsStatements) {
    for (const txn of items) {
      rows.push({
        id: `savings-${txn.type}:${txn.id}`,
        kind:
          txn.type === "deposit"
            ? "savings-deposit"
            : txn.type === "closure"
              ? "savings-closure"
              : "savings-withdrawal",
        product: "savings",
        at: txn.createdAt || txn.accraDay,
        amount: txn.amount,
        fee: txn.fee,
        customerName: account.customerName ?? UNNAMED,
        accountLabel: `Savings ${account.accountNumber}`,
        to: `/savings/${account.id}`,
        detail: `Balance ${formatGhs(txn.balanceAfter, { symbol: null })}`,
        recordedById: txn.recordedById,
      });
    }
  }

  for (const { loan, repayments } of loanDetails) {
    for (const repayment of repayments) {
      rows.push({
        id: `loan-repayment:${repayment.id}`,
        kind: "loan-repayment",
        product: "loan",
        at: repayment.createdAt,
        amount: repayment.amount,
        customerName: loan.customerName ?? UNNAMED,
        accountLabel: `Loan ${formatGhs(loan.principal, { symbol: null })}`,
        to: `/loans/${loan.id}`,
        detail: repaymentSourceLabel(repayment.source),
        recordedById: repayment.recordedById,
      });
    }
  }

  for (const { agreement, payments } of hpDetails) {
    payments.forEach((payment, index) => {
      // The payment response is undeclared, so take only what is recognisable.
      const amount = readNumber(payment, ["amount", "amountPaid", "paid"]);
      const at = readString(payment, [
        "createdAt",
        "paidAt",
        "date",
        "recordedAt",
        "dueDate",
      ]);
      if (amount === null || amount <= 0 || at === null) return;

      rows.push({
        id: `hp-payment:${agreement.id}:${readString(payment, ["id", "_id"]) ?? index}`,
        kind: "hp-payment",
        product: "hire-purchase",
        at,
        amount,
        customerName: agreement.customerName ?? UNNAMED,
        accountLabel: agreement.item.name,
        to: `/hire-purchase/${agreement.id}`,
        recordedById:
          readString(payment, ["recordedById", "collectorId"]) ?? undefined,
      });
    });
  }

  rows.sort((a, b) => b.at.localeCompare(a.at));
  return { rows, accountsRead, totalAccounts, pageCount, covered };
}

function readNumber(
  row: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function readString(
  row: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}
