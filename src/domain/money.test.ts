import { describe, expect, it } from "vitest";
import { assertIntegerMinor, formatMYR, parseMoneyInput, percentageOfMinor } from "./money";

describe("money utilities", () => {
  it("parses MYR strings into integer sen", () => {
    expect(parseMoneyInput("RM1,234.50")).toBe(123_450);
    expect(parseMoneyInput("42")).toBe(4_200);
    expect(parseMoneyInput("-RM19.90")).toBe(-1_990);
  });

  it("formats integer sen as MYR with cents", () => {
    expect(formatMYR(123_450)).toBe("RM1,234.50");
    expect(formatMYR(-4_207)).toBe("-RM42.07");
  });

  it("rejects fractional sen and invalid input", () => {
    expect(() => assertIntegerMinor(10.5)).toThrow(/integer/);
    expect(() => parseMoneyInput("12.345")).toThrow(/at most two/);
  });

  it("rounds percentages to sen using half-up basis points", () => {
    expect(percentageOfMinor(10_005, 1_000)).toBe(1_001);
    expect(percentageOfMinor(333, 3_333)).toBe(111);
    expect(percentageOfMinor(-10_005, 1_000)).toBe(-1_001);
  });
});
