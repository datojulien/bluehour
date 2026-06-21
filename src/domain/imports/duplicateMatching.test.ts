import { describe, expect, it } from "vitest";
import { normaliseDescription, scoreDuplicateMatch } from "./duplicateMatching";

describe("duplicate matching", () => {
  it("normalises imported descriptions", () => {
    expect(normaliseDescription("  BANYAN-MARKET #4812  ")).toBe("banyan market 4812");
  });

  it("returns strong matches for high-confidence duplicate signals", () => {
    expect(
      scoreDuplicateMatch(
        {
          sourceReference: "abc",
          accountId: "acc",
          amountMinor: -12_300,
          occurredOn: "2026-07-12",
          description: "Banyan Market"
        },
        {
          sourceReference: "abc",
          accountId: "acc",
          amountMinor: -12_300,
          occurredOn: "2026-07-13",
          description: "Banyan Market groceries"
        }
      ).outcome
    ).toBe("strong");
  });

  it("separates uncertain matches from new imported rows", () => {
    const uncertain = scoreDuplicateMatch(
      { accountId: "acc", amountMinor: -4_200, occurredOn: "2026-07-12", description: "Lumen Fuel" },
      { accountId: "acc", amountMinor: -4_200, occurredOn: "2026-07-13", description: "Lumen petrol" }
    );
    const fresh = scoreDuplicateMatch(
      { accountId: "acc-1", amountMinor: -4_200, occurredOn: "2026-07-12", description: "Lumen Fuel" },
      { accountId: "acc-2", amountMinor: -9_900, occurredOn: "2026-07-20", description: "Orchid Cloud" }
    );

    expect(uncertain.outcome).toBe("uncertain");
    expect(fresh.outcome).toBe("new");
  });
});
