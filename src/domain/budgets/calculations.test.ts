import { describe, expect, it } from "vitest";
import { calculateBudgetTransferDelta, calculateCategoryAllocation, calculateRemainingAllocation } from "./calculations";
import { createDemoSnapshot } from "../../test/fixtures/demoData";

describe("budget calculations", () => {
  it("applies approved budget transfers without creating account movement", () => {
    const demo = createDemoSnapshot();
    const cycle = demo.budgetCycles[0];

    expect(calculateBudgetTransferDelta("cat-dining", cycle.id, demo.budgetTransfers)).toBe(10_000);
    expect(calculateBudgetTransferDelta("cat-entertainment", cycle.id, demo.budgetTransfers)).toBe(-10_000);
    expect(calculateCategoryAllocation("cat-dining", cycle, demo.budgetAllocations, demo.budgetTransfers)).toBe(80_000);
    expect(calculateCategoryAllocation("cat-entertainment", cycle, demo.budgetAllocations, demo.budgetTransfers)).toBe(20_000);
  });

  it("does not let remaining allocation go below zero", () => {
    expect(calculateRemainingAllocation(5_000, 6_500)).toBe(0);
  });
});
