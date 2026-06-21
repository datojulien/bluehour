import { describe, expect, it } from "vitest";
import { closeCycleForActualSalary, nextSalaryWindowFromStart } from "./salaryCycle";
import { createDemoSnapshot } from "../../test/fixtures/demoData";

describe("salary cycle helpers", () => {
  it("creates the conservative next salary window from the actual cycle start", () => {
    expect(nextSalaryWindowFromStart("2026-06-24", 24, 26)).toEqual({
      expectedNextSalaryFrom: "2026-07-24",
      expectedNextSalaryTo: "2026-07-26"
    });
  });

  it("closes a cycle early when salary arrives before the usual window", () => {
    const cycle = createDemoSnapshot().budgetCycles[0];
    const { closedCycle, newCycle } = closeCycleForActualSalary(cycle, "2026-07-22", "txn-salary-july", 780_000);

    expect(closedCycle.endedOn).toBe("2026-07-21");
    expect(closedCycle.status).toBe("closed");
    expect(newCycle.startedOn).toBe("2026-07-22");
    expect(newCycle.expectedNextSalaryFrom).toBe("2026-08-24");
    expect(newCycle.expectedNextSalaryTo).toBe("2026-08-26");
  });
});
