import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "../test/fixtures/demoData";
import {
  createProfileManifest,
  inferLegacyLifecycle,
  nextManifestForCheckpoint,
  parseProfileManifest,
  profileManifestSettingRecord,
  readProfileManifest,
  shellStateFromManifest,
  validateManifestAgainstSnapshot
} from "./profileManifest";

const now = "2026-06-22T09:42:00.000Z";
const appVersion = "1.0.0-rc.2";

describe("profile manifest", () => {
  it("validates setup lifecycle manifests", () => {
    const manifest = createProfileManifest({ now, appVersion, lifecycle: "setup", onboardingStep: "budget" });

    expect(parseProfileManifest(manifest)).toMatchObject({
      lifecycle: "setup",
      onboardingStep: "budget",
      currency: "MYR"
    });
  });

  it("validates ready-for-salary lifecycle shell reconstruction", () => {
    const manifest = createProfileManifest({ now, appVersion, lifecycle: "ready_for_salary", onboardingStep: "start_cycle" });

    expect(shellStateFromManifest(manifest)).toEqual({
      applicationState: "ready_for_salary",
      onboardingStep: "start_cycle"
    });
  });

  it("validates live lifecycle shell reconstruction", () => {
    const setup = createProfileManifest({ now, appVersion });
    const live = nextManifestForCheckpoint({ current: setup, now, appVersion, lifecycle: "live" });

    expect(live.onboardingStep).toBeUndefined();
    expect(shellStateFromManifest(live)).toEqual({
      applicationState: "live",
      onboardingStep: "start_cycle"
    });
  });

  it("rejects invalid manifest shapes", () => {
    expect(() => parseProfileManifest({ manifestVersion: 1, profileId: "not-a-uuid" })).toThrow();
  });

  it("round-trips as a typed settings record", () => {
    const manifest = createProfileManifest({ now, appVersion });
    const setting = profileManifestSettingRecord([], manifest);

    expect(readProfileManifest([setting])?.profileId).toBe(manifest.profileId);
  });

  it("detects manifest and record inconsistencies", () => {
    const live = nextManifestForCheckpoint({
      current: createProfileManifest({ now, appVersion }),
      now,
      appVersion,
      lifecycle: "live"
    });

    expect(validateManifestAgainstSnapshot(live, { budgetCycles: [] })).toEqual([
      "Profile manifest says this profile is live, but no salary cycle exists."
    ]);
  });

  it("infers legacy live state from an open salary cycle", () => {
    const snapshot = createDemoSnapshot();
    const inference = inferLegacyLifecycle(snapshot);

    expect(inference.lifecycle).toBe("live");
    expect(inference.evidence.join(" ")).toMatch(/salary cycle/i);
  });

  it("infers uncertain setup state from legacy onboarding records", () => {
    const snapshot = { ...createDemoSnapshot(), budgetCycles: [], transactions: [] };
    const inference = inferLegacyLifecycle(snapshot);

    expect(inference.lifecycle).toBe("setup");
    expect(inference.confidence).toBe("uncertain");
  });
});
