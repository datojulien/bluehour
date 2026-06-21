import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "../../test/fixtures/demoData";
import { closeSalaryCycleWithActualSalary, protectedTargetForSalary, startFirstSalaryCycle } from "./cycleCommands";

describe("salary-cycle commands", () => {
  it("starts the first cycle from actual salary arrival without double-counting salary", () => {
    const result = startFirstSalaryCycle({
      salaryDate: "2026-07-24",
      salaryDepositText: "RM7,800.00",
      currentBalanceText: "RM9,200.00",
      destinationAccountId: "acc-bank",
      incomeCategoryId: "cat-income"
    });

    expect(result.openingSnapshot.amountMinor).toBe(140_000);
    expect(result.openingSnapshot.asOfDate).toBe("2026-07-23");
    expect(result.salaryLeg.deltaMinor).toBe(780_000);
    expect(result.cycle.startedOn).toBe("2026-07-24");
    expect(result.cycle.actualMainSalaryMinor).toBe(780_000);
  });

  it("closes a cycle on actual salary arrival and copies the approved budget template", () => {
    const demo = createDemoSnapshot();
    const result = closeSalaryCycleWithActualSalary({
      currentCycle: demo.budgetCycles[0],
      actualSalaryDate: "2026-07-22",
      salaryDepositText: "RM7,900.00",
      destinationAccountId: "acc-meranti-current",
      incomeCategoryId: "cat-income",
      categories: demo.categories,
      allocations: demo.budgetAllocations,
      skipReconciliationNote: "Demo skip note."
    });

    expect(result.closedCycle.endedOn).toBe("2026-07-21");
    expect(result.newCycle.startedOn).toBe("2026-07-22");
    expect(result.salaryLeg.deltaMinor).toBe(790_000);
    expect(result.nextAllocations).toHaveLength(demo.budgetAllocations.length);
    expect(result.nextAllocations.every((allocation) => allocation.budgetCycleId === result.newCycle.id)).toBe(true);
  });

  it("calculates the minimum protected contribution from salary", () => {
    expect(protectedTargetForSalary("RM7,800.00")).toBe(78_000);
  });
});
