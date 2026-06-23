import { describe, expect, it } from "vitest";
import { monthlyEquivalentMinor } from "./subscriptionMath";

describe("subscription monthly equivalent", () => {
  it("uses monthly amounts directly", () => {
    expect(monthlyEquivalentMinor(3_999, "monthly")).toMatchObject({
      monthlyMinor: 3_999,
      annualMinor: 47_988,
      estimated: false
    });
  });

  it("rounds quarterly amounts half-up by integer sen", () => {
    expect(monthlyEquivalentMinor(10_001, "quarterly").monthlyMinor).toBe(3_334);
  });

  it("rounds yearly amounts half-up by integer sen", () => {
    expect(monthlyEquivalentMinor(100_001, "yearly").monthlyMinor).toBe(8_333);
  });

  it("labels weekly monthly values as estimates", () => {
    const result = monthlyEquivalentMinor(1_001, "weekly");

    expect(result.monthlyMinor).toBe(4_338);
    expect(result.annualMinor).toBe(52_052);
    expect(result.estimated).toBe(true);
  });

  it("treats custom cadence as a documented monthly estimate", () => {
    const result = monthlyEquivalentMinor(2_500, "custom");

    expect(result.monthlyMinor).toBe(2_500);
    expect(result.explanation).toContain("monthly estimate");
  });
});
