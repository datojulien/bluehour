import { describe, expect, it } from "vitest";
import type { Account, BluehourSnapshot, Category, Transaction, TransactionLeg, TransactionSplit } from "../types";
import { rankDuplicateCandidates } from "./importMatching";

const now = "2026-07-01T00:00:00.000Z";

function meta(id: string) {
  return { id, createdAt: now, updatedAt: now, archivedAt: null, revision: 1 };
}

describe("import duplicate candidate ranking", () => {
  it("uses the imported account leg for transfer matching", () => {
    const snapshot = snapshotWithTransactions({
      transactions: [transaction("txn-transfer", "transfer", "2026-07-02", "Wallet top-up")],
      transactionLegs: [
        leg("leg-transfer-bank", "txn-transfer", "acc-bank", -10_000),
        leg("leg-transfer-wallet", "txn-transfer", "acc-wallet", 10_000)
      ],
      transactionSplits: []
    });

    const walletCandidates = rankDuplicateCandidates(
      {
        accountId: "acc-wallet",
        signedAmountMinor: 10_000,
        occurredOn: "2026-07-02",
        description: "Wallet top-up"
      },
      snapshot
    );
    const bankCandidates = rankDuplicateCandidates(
      {
        accountId: "acc-bank",
        signedAmountMinor: -10_000,
        occurredOn: "2026-07-02",
        description: "Wallet top-up"
      },
      snapshot
    );

    expect(walletCandidates[0]).toMatchObject({ transactionId: "txn-transfer" });
    expect(walletCandidates[0].reasons).toContain("same amount");
    expect(bankCandidates[0]).toMatchObject({ transactionId: "txn-transfer" });
    expect(bankCandidates[0].reasons).toContain("same amount");
  });

  it("skips candidates with no ledger leg for the imported account", () => {
    const snapshot = snapshotWithTransactions({
      transactions: [transaction("txn-other-account", "expense", "2026-07-02", "Other account purchase")],
      transactionLegs: [leg("leg-other", "txn-other-account", "acc-bank", -5_000)],
      transactionSplits: [split("split-other", "txn-other-account", "cat-a", 5_000)]
    });

    expect(
      rankDuplicateCandidates(
        {
          accountId: "acc-wallet",
          signedAmountMinor: -5_000,
          occurredOn: "2026-07-02",
          description: "Other account purchase"
        },
        snapshot
      )
    ).toEqual([]);
  });

  it("uses the account leg rather than split totals for split-category transactions", () => {
    const snapshot = snapshotWithTransactions({
      transactions: [transaction("txn-split", "expense", "2026-07-02", "Split purchase")],
      transactionLegs: [leg("leg-split", "txn-split", "acc-bank", -12_000)],
      transactionSplits: [
        split("split-a", "txn-split", "cat-a", 7_000),
        split("split-b", "txn-split", "cat-b", 5_000)
      ]
    });

    const candidates = rankDuplicateCandidates(
      {
        accountId: "acc-bank",
        signedAmountMinor: -12_000,
        occurredOn: "2026-07-02",
        description: "Split purchase"
      },
      snapshot
    );

    expect(candidates[0]).toMatchObject({ transactionId: "txn-split" });
    expect(candidates[0].reasons).toContain("same amount");
  });

  it("preserves ranked transaction IDs and scores for refunds", () => {
    const snapshot = snapshotWithTransactions({
      transactions: [transaction("txn-refund", "refund", "2026-07-02", "Store refund")],
      transactionLegs: [leg("leg-refund", "txn-refund", "acc-bank", 2_000)],
      transactionSplits: [split("split-refund", "txn-refund", "cat-a", 2_000, "reversal")]
    });

    const candidates = rankDuplicateCandidates(
      {
        accountId: "acc-bank",
        signedAmountMinor: 2_000,
        occurredOn: "2026-07-03",
        description: "Store refund"
      },
      snapshot
    );

    expect(candidates[0].transactionId).toBe("txn-refund");
    expect(candidates[0].score).toBeGreaterThanOrEqual(50);
  });
});

function snapshotWithTransactions(input: {
  transactions: Transaction[];
  transactionLegs: TransactionLeg[];
  transactionSplits: TransactionSplit[];
}): BluehourSnapshot {
  return {
    accounts: [account("acc-bank", "Bank"), account("acc-wallet", "Wallet")],
    balanceSnapshots: [],
    transactions: input.transactions,
    transactionLegs: input.transactionLegs,
    transactionSplits: input.transactionSplits,
    categories: [category("cat-a"), category("cat-b")],
    budgetCycles: [],
    budgetAllocations: [],
    budgetTransfers: [],
    recurringRules: [],
    planInstances: [],
    subscriptions: [],
    categorisationRules: [],
    importProfiles: [],
    importBatches: [],
    importRowAudits: [],
    reconciliations: [],
    reviewSessions: [],
    settings: [],
    outboxOperations: [],
    conflicts: [],
    syncState: []
  };
}

function account(id: string, name: string): Account {
  return {
    ...meta(id),
    name,
    type: id.includes("wallet") ? "ewallet" : "bank",
    role: "spendable",
    trackingMode: "ledger",
    currency: "MYR",
    reconcileWeekly: true,
    sortOrder: 1
  };
}

function category(id: string): Category {
  return {
    ...meta(id),
    name: id,
    group: "discretionary",
    nature: "discretionary",
    reservationMode: "envelope",
    sortOrder: 1,
    active: true
  };
}

function transaction(id: string, type: Transaction["type"], occurredOn: Transaction["occurredOn"], description: string): Transaction {
  return {
    ...meta(id),
    type,
    status: "actual",
    occurredOn,
    description,
    source: "manual"
  };
}

function leg(id: string, transactionId: string, accountId: string, deltaMinor: number): TransactionLeg {
  return { ...meta(id), transactionId, accountId, deltaMinor };
}

function split(
  id: string,
  transactionId: string,
  categoryId: string,
  amountMinor: number,
  direction: TransactionSplit["direction"] = "expense"
): TransactionSplit {
  return { ...meta(id), transactionId, categoryId, amountMinor, direction };
}
