import { describe, expect, it } from "vitest";
import type { RecurringRule } from "../types";
import { generateRecurringPlanInstances } from "./recurrence";

describe("recurrence generation", () => {
  it("generates monthly instances with day-of-month clamping", () => {
    const rule: RecurringRule = {
      id: "rule-monthly",
      name: "Month-end bill",
      kind: "expense",
      frequency: "monthly",
      interval: 1,
      startDate: "2026-01-31",
      dayOfMonth: 31,
      amountMode: "fixed",
      amountMinor: 12_000,
      categoryId: "cat-utilities",
      essential: true,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
      revision: 1
    };

    expect(generateRecurringPlanInstances(rule, "2026-01-01", "2026-03-31").map((instance) => instance.expectedDate)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31"
    ]);
  });
});
