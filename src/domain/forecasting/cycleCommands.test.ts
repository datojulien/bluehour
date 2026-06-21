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

  it("refuses to start a first salary cycle when one is already open", () => {
    const demo = createDemoSnapshot();

    expect(() =>
      startFirstSalaryCycle({
        salaryDate: "2026-07-24",
        salaryDepositText: "RM7,800.00",
        currentBalanceText: "RM9,200.00",
        destinationAccountId: "acc-bank",
        incomeCategoryId: "cat-income",
        existingCycles: demo.budgetCycles
      })
    ).toThrow("An open salary cycle already exists");
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
      reconciliationComplete: false,
      skipReconciliationNote: "Demo skip note."
    });

    expect(result.closedCycle.endedOn).toBe("2026-07-21");
    expect(result.newCycle.startedOn).toBe("2026-07-22");
    expect(result.salaryLeg.deltaMinor).toBe(790_000);
    expect(result.nextAllocations).toHaveLength(demo.budgetAllocations.length);
    expect(result.nextAllocations.every((allocation) => allocation.budgetCycleId === result.newCycle.id)).toBe(true);
  });

  it("allows cycle close without skip note when reconciliation is complete", () => {
    const demo = createDemoSnapshot();
    const result = closeSalaryCycleWithActualSalary({
      currentCycle: demo.budgetCycles[0],
      actualSalaryDate: "2026-07-26",
      salaryDepositText: "RM7,900.00",
      destinationAccountId: "acc-meranti-current",
      incomeCategoryId: "cat-income",
      categories: demo.categories,
      allocations: demo.budgetAllocations,
      reconciliationComplete: true
    });

    expect(result.closedCycle.status).toBe("closed");
  });

  it("requires reconciliation completion or an explicit cycle-close skip note", () => {
    const demo = createDemoSnapshot();

    expect(() =>
      closeSalaryCycleWithActualSalary({
        currentCycle: demo.budgetCycles[0],
        actualSalaryDate: "2026-07-26",
        salaryDepositText: "RM7,900.00",
        destinationAccountId: "acc-meranti-current",
        incomeCategoryId: "cat-income",
        categories: demo.categories,
        allocations: demo.budgetAllocations
      })
    ).toThrow("Cycle close requires completed reconciliation or an explicit skip note");
  });

  it("does not close the same salary cycle twice", () => {
    const demo = createDemoSnapshot();

    expect(() =>
      closeSalaryCycleWithActualSalary({
        currentCycle: { ...demo.budgetCycles[0], status: "closed" },
        actualSalaryDate: "2026-07-26",
        salaryDepositText: "RM7,900.00",
        destinationAccountId: "acc-meranti-current",
        incomeCategoryId: "cat-income",
        categories: demo.categories,
        allocations: demo.budgetAllocations,
        skipReconciliationNote: "Already handled."
      })
    ).toThrow("Only an open salary cycle can be closed");
  });

  it("calculates the minimum protected contribution from salary", () => {
    expect(protectedTargetForSalary("RM7,800.00")).toBe(78_000);
  });
});
