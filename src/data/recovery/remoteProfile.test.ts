import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "../../test/fixtures/demoData";
import { createProfileManifest, profileManifestSettingRecord } from "../../domain/profileManifest";
import { inspectRemoteSnapshot, prepareRemoteRestore } from "./remoteProfile";

const now = "2026-06-22T09:42:00.000Z";
const appVersion = "1.0.0-rc.1";

describe("remote profile recovery", () => {
  it("previews a manifest-backed remote profile without balances", () => {
    const manifest = createProfileManifest({ now, appVersion, lifecycle: "live" });
    const snapshot = {
      ...createDemoSnapshot(),
      settings: [profileManifestSettingRecord([], manifest)]
    };
    const inspection = inspectRemoteSnapshot("sheet-12345678", {
      remoteRevision: 14,
      schemaVersion: 3,
      exportedAt: now,
      snapshot
    });

    expect(inspection.remoteRevision).toBe(14);
    expect(inspection.manifest?.profileId).toBe(manifest.profileId);
    expect(inspection.counts.accounts).toBeGreaterThan(0);
  });

  it("prepares an empty-device restore without outbox operations", () => {
    const manifest = createProfileManifest({ now, appVersion, lifecycle: "live" });
    const snapshot = {
      ...createDemoSnapshot(),
      settings: [profileManifestSettingRecord([], manifest)]
    };
    const inspection = inspectRemoteSnapshot("sheet-12345678", {
      remoteRevision: 4,
      schemaVersion: 3,
      snapshot
    });
    const restore = prepareRemoteRestore({ inspection, now, appVersion, deviceId: "35bb9de6-cf63-43d5-afb9-19dcba1b69bd" });

    expect(restore.snapshot.outboxOperations).toEqual([]);
    expect(restore.snapshot.syncState[0]).toMatchObject({
      status: "synced",
      remoteRevision: 4,
      spreadsheetId: "sheet-12345678"
    });
    expect(restore.shell.applicationState).toBe("live");
  });

  it("blocks restore preparation when manifest and records are inconsistent", () => {
    const manifest = createProfileManifest({ now, appVersion, lifecycle: "live" });
    const inspection = inspectRemoteSnapshot("sheet-12345678", {
      remoteRevision: 4,
      schemaVersion: 3,
      snapshot: {
        ...createDemoSnapshot(),
        budgetCycles: [],
        settings: [profileManifestSettingRecord([], manifest)]
      }
    });

    expect(() => prepareRemoteRestore({ inspection, now, appVersion })).toThrow(/manifest says this profile is live/i);
  });

  it("creates a guarded manifest for legacy Sheets only after confirmation input", () => {
    const inspection = inspectRemoteSnapshot("sheet-12345678", {
      remoteRevision: 4,
      schemaVersion: 2,
      snapshot: {
        ...createDemoSnapshot(),
        settings: []
      }
    });
    const restore = prepareRemoteRestore({
      inspection,
      now,
      appVersion,
      legacyChoice: { lifecycle: "setup", onboardingStep: "budget" }
    });

    expect(inspection.manifest).toBeNull();
    expect(restore.manifest.lifecycle).toBe("setup");
    expect(restore.manifest.onboardingStep).toBe("budget");
  });
});
