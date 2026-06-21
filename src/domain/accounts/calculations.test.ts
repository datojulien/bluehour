import { describe, expect, it } from "vitest";
import { calculateAccountBalances, calculateNetSpendableBalance } from "./calculations";
import { createDemoSnapshot, demoAsOfDate } from "../../test/fixtures/demoData";

describe("account calculations", () => {
  it("calculates spendable balances with credit-card balances reducing capacity", () => {
    const demo = createDemoSnapshot();
    const balances = calculateAccountBalances(demo.accounts, demo.balanceSnapshots, demo.transactions, demo.transactionLegs, demoAsOfDate);

    expect(balances.find((balance) => balance.account.id === "acc-meranti-current")?.balanceMinor).toBe(534_430);
    expect(balances.find((balance) => balance.account.id === "acc-harbour-wallet")?.balanceMinor).toBe(21_600);
    expect(balances.find((balance) => balance.account.id === "acc-rainstone-card")?.balanceMinor).toBe(-24_670);
    expect(calculateNetSpendableBalance(balances)).toBe(531_360);
  });

  it("excludes archived transactions from account balances", () => {
    const demo = createDemoSnapshot();
    const archivedRent = demo.transactions.map((transaction) =>
      transaction.id === "txn-rent" ? { ...transaction, archivedAt: "2026-07-12T00:00:00.000Z" } : transaction
    );
    const balances = calculateAccountBalances(demo.accounts, demo.balanceSnapshots, archivedRent, demo.transactionLegs, demoAsOfDate);

    expect(balances.find((balance) => balance.account.id === "acc-meranti-current")?.balanceMinor).toBe(754_430);
  });
});
