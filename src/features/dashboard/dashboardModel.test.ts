import { describe, expect, it } from "vitest";
import { createDemoSnapshot, demoAsOfDate } from "../../test/fixtures/demoData";
import { buildDailyTimeline, buildDashboardModel } from "./dashboardModel";

describe("dashboard model", () => {
  it("uses a virtual future salary cycle when a projected horizon crosses payday", () => {
    const model = buildDashboardModel(createDemoSnapshot(), demoAsOfDate);
    const untilSalary = model.periods.untilSalary.projected;
    const next30Days = model.periods.next30Days.projected;

    expect(next30Days.horizonEndDate).toBe("2026-08-10");
    expect(next30Days.protectedReserveMinor).toBeGreaterThan(untilSalary.protectedReserveMinor);
    expect(next30Days.breakdown.essentialEnvelopeReserves.some((reserve) => reserve.label.includes("estimated next cycle"))).toBe(true);
    expect(next30Days.breakdown.warnings).toContain(
      "Projected salary starts an estimated next salary cycle using the current approved budget template."
    );
  });

  it("expands sparse forecast events into deterministic daily timeline points", () => {
    const model = buildDashboardModel(createDemoSnapshot(), demoAsOfDate);
    const timeline = buildDailyTimeline(model.periods.next30Days.projected, 30);

    expect(timeline).toHaveLength(30);
    expect(timeline[0].date).toBe(demoAsOfDate);
    expect(timeline.map((point) => point.date)).toContain("2026-07-26");
    expect(timeline.some((point) => point.labels.includes("Main salary estimate"))).toBe(true);
  });
});
