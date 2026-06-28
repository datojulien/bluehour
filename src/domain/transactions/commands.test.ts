import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "../../test/fixtures/demoData";
import { createTransactionRecords, editTransactionRecords } from "./commands";

describe("transaction commands", () => {
  it("creates expense legs and applies approved categorisation rules", () => {
    const snapshot = createDemoSnapshot();
    const result = createTransactionRecords(
      {
        type: "expense",
        occurredOn: "2026-07-12",
        description: "Banyan Market snacks",
        amountMinor: 1_250,
        accountId: "acc-meranti-current"
      },
      snapshot
    );

    expect(result.legs).toHaveLength(1);
    expect(result.legs[0].deltaMinor).toBe(-1_250);
    expect(result.splits[0]).toMatchObject({
      categoryId: "cat-groceries",
      direction: "expense",
      amountMinor: 1_250
    });
    expect(result.updatedRule?.hitCount).toBe(2);
  });

  it("creates transfer legs without category spending", () => {
    const snapshot = createDemoSnapshot();
    const result = createTransactionRecords(
      {
        type: "transfer",
        occurredOn: "2026-07-12",
        description: "Wallet top-up",
        amountMinor: 5_000,
        accountId: "acc-meranti-current",
        toAccountId: "acc-harbour-wallet"
      },
      snapshot
    );

    expect(result.legs.map((leg) => leg.deltaMinor)).toEqual([-5_000, 5_000]);
    expect(result.splits).toEqual([]);
  });

  it("links planned transactions when fulfilled", () => {
    const snapshot = createDemoSnapshot();
    const result = createTransactionRecords(
      {
        type: "expense",
        occurredOn: "2026-07-16",
        description: "Insurance premium",
        amountMinor: 18_000,
        accountId: "acc-meranti-current",
        categoryId: "cat-insurance",
        planInstanceId: "plan-insurance"
      },
      snapshot
    );

    expect(result.updatedPlan?.status).toBe("fulfilled");
    expect(result.updatedPlan?.linkedTransactionId).toBe(result.transaction.id);
  });

  it("prevents a planned item from being fulfilled twice", () => {
    const snapshot = createDemoSnapshot();
    const fulfilledSnapshot = {
      ...snapshot,
      planInstances: snapshot.planInstances.map((plan) =>
        plan.id === "plan-insurance" ? { ...plan, status: "fulfilled" as const, linkedTransactionId: "txn-existing" } : plan
      )
    };

    expect(() =>
      createTransactionRecords(
        {
          type: "expense",
          occurredOn: "2026-07-16",
          description: "Insurance premium",
          amountMinor: 18_000,
          accountId: "acc-meranti-current",
          categoryId: "cat-insurance",
          planInstanceId: "plan-insurance"
        },
        fulfilledSnapshot
      )
    ).toThrow("Planned item has already been fulfilled or closed");
  });

  it("edits a transaction by replacing active ledger legs and splits", () => {
    const snapshot = createDemoSnapshot();
    const existing = snapshot.transactions.find((transaction) => transaction.id === "txn-dining");
    if (!existing) {
      throw new Error("Missing demo transaction");
    }

    const result = editTransactionRecords(
      existing,
      {
        type: "expense",
        occurredOn: "2026-07-05",
        description: "Saffron Lane dinner",
        amountMinor: 4_200,
        accountId: "acc-meranti-current",
        categoryId: "cat-entertainment"
      },
      snapshot
    );

    expect(result.transaction.id).toBe(existing.id);
    expect(result.transaction.occurredOn).toBe("2026-07-05");
    expect(result.transaction.description).toBe("Saffron Lane dinner");
    expect(result.archivedLegs).toHaveLength(1);
    expect(result.archivedLegs[0]).toMatchObject({ id: "leg-dining-current", archivedAt: expect.any(String) });
    expect(result.archivedSplits).toHaveLength(1);
    expect(result.archivedSplits[0]).toMatchObject({ id: "split-dining", archivedAt: expect.any(String) });
    expect(result.legs).toHaveLength(1);
    expect(result.legs[0]).toMatchObject({ transactionId: "txn-dining", accountId: "acc-meranti-current", deltaMinor: -4_200 });
    expect(result.splits).toHaveLength(1);
    expect(result.splits[0]).toMatchObject({
      transactionId: "txn-dining",
      categoryId: "cat-entertainment",
      direction: "expense",
      amountMinor: 4_200
    });
  });
});
