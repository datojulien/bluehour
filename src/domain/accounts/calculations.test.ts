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

  it("treats balance snapshots as end-of-day boundaries to avoid same-day double counting", () => {
    const demo = createDemoSnapshot();
    const accountId = "acc-meranti-current";
    const snapshots = [
      ...demo.balanceSnapshots,
      {
        id: "bal-reconciled-boundary",
        accountId,
        asOfDate: "2026-07-12" as const,
        amountMinor: 534_430,
        source: "reconciliation" as const,
        createdAt: "2026-07-12T12:00:00.000Z",
        updatedAt: "2026-07-12T12:00:00.000Z",
        archivedAt: null,
        revision: 1
      }
    ];
    const sameDayTransaction = {
      id: "txn-same-day-after-snapshot",
      type: "expense" as const,
      status: "actual" as const,
      occurredOn: "2026-07-12" as const,
      description: "Same day coffee",
      source: "manual" as const,
      createdAt: "2026-07-12T13:00:00.000Z",
      updatedAt: "2026-07-12T13:00:00.000Z",
      archivedAt: null,
      revision: 1
    };
    const nextDayTransaction = {
      ...sameDayTransaction,
      id: "txn-next-day-after-snapshot",
      occurredOn: "2026-07-13" as const
    };
    const legs = [
      ...demo.transactionLegs,
      {
        id: "leg-same-day-after-snapshot",
        transactionId: sameDayTransaction.id,
        accountId,
        deltaMinor: -1_200,
        createdAt: sameDayTransaction.createdAt,
        updatedAt: sameDayTransaction.updatedAt,
        archivedAt: null,
        revision: 1
      },
      {
        id: "leg-next-day-after-snapshot",
        transactionId: nextDayTransaction.id,
        accountId,
        deltaMinor: -2_300,
        createdAt: nextDayTransaction.createdAt,
        updatedAt: nextDayTransaction.updatedAt,
        archivedAt: null,
        revision: 1
      }
    ];

    const sameDay = calculateAccountBalances(demo.accounts, snapshots, [...demo.transactions, sameDayTransaction], legs, "2026-07-12");
    const nextDay = calculateAccountBalances(demo.accounts, snapshots, [...demo.transactions, sameDayTransaction, nextDayTransaction], legs, "2026-07-13");

    expect(sameDay.find((balance) => balance.account.id === accountId)?.balanceMinor).toBe(534_430);
    expect(nextDay.find((balance) => balance.account.id === accountId)?.balanceMinor).toBe(532_130);
  });
});
