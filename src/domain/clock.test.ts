import { describe, expect, it } from "vitest";
import { browserLocalToday, demoClock } from "./clock";

describe("Bluehour clocks", () => {
  it("keeps demo mode deterministic", () => {
    expect(demoClock.today()).toBe("2026-07-12");
    expect(demoClock.now()).toBe("2026-07-12T08:00:00.000Z");
  });

  it("formats a browser-local date without UTC day shifting", () => {
    expect(browserLocalToday(new Date(2026, 0, 2, 23, 30))).toBe("2026-01-02");
  });
});
