import { describe, expect, it } from "vitest";
import { calculateCategoryActuals, calculateRefundReversalAmount, validateSplits, validateTransferLegs } from "./calculations";
import { createDemoSnapshot, demoAsOfDate } from "../../test/fixtures/demoData";

describe("transaction calculations", () => {
  it("validates that transaction splits equal the transaction amount", () => {
    expect(() =>
      validateSplits(10_000, [
        { direction: "expense", amountMinor: 6_000 },
        { direction: "expense", amountMinor: 4_000 }
      ])
    ).not.toThrow();

    expect(() =>
      validateSplits(10_000, [
        { direction: "expense", amountMinor: 6_000 },
        { direction: "expense", amountMinor: 3_999 }
      ])
    ).toThrow(/Split total/);
  });

  it("validates transfers including explicit fee expense", () => {
    expect(() => validateTransferLegs([{ deltaMinor: -5_000 }, { deltaMinor: 5_000 }])).not.toThrow();
    expect(() => validateTransferLegs([{ deltaMinor: -5_050 }, { deltaMinor: 5_000 }], 50)).not.toThrow();
    expect(() => validateTransferLegs([{ deltaMinor: -5_050 }, { deltaMinor: 5_000 }])).toThrow(/Transfer account legs/);
  });

  it("treats refunds as category reversals while preserving the original transaction", () => {
    const demo = createDemoSnapshot();

    expect(calculateRefundReversalAmount("txn-shopping-refund", demo.transactionSplits)).toBe(3_000);
    expect(calculateCategoryActuals("cat-shopping", demo.transactions, demo.transactionSplits, "2026-06-24", demoAsOfDate)).toBe(9_600);
  });
});
