import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "../../test/fixtures/demoData";
import { inspectDriveVaultProfile, prepareDriveVaultReadOnlyRestore, prepareDriveVaultRestore } from "./driveProfile";
import { snapshotForRemoteVault, type RemoteDriveVaultSnapshot } from "../google/driveAppDataVault";
import { createProfileManifest, profileManifestSettingRecord } from "../../domain/profileManifest";
import type { BudgetCycle } from "../../domain/types";

const files = {
  manifestFileId: "manifest-file",
  slotAFileId: "slot-a-file",
  slotBFileId: "slot-b-file"
};

const account = {
  sub: "google-subject",
  email: "person@example.com",
  name: "Example Person"
};

describe("Drive profile recovery", () => {
  it("prepares an atomic local restore from a Drive vault snapshot", () => {
    const manifest = createProfileManifest({ now: "2026-06-22T09:42:00.000Z", appVersion: "1.0.0-rc.2", lifecycle: "live" });
    const base = createDemoSnapshot();
    const source = {
      ...base,
      settings: [...base.settings.filter((setting) => setting.key !== "profileManifest"), profileManifestSettingRecord([], manifest)]
    };
    const remote: RemoteDriveVaultSnapshot = {
      manifest: {
        kind: "bluehour-drive-vault-manifest",
        schemaVersion: 2,
        remoteRevision: 6,
        activeSlot: "B",
        files
      },
      activeSlot: "B",
      schemaVersion: 2,
      remoteRevision: 6,
      exportedAt: "2026-06-22T09:42:00.000Z",
      snapshot: snapshotForRemoteVault(source)
    };
    const inspection = inspectDriveVaultProfile(files, account, remote);

    const restore = prepareDriveVaultRestore({
      inspection,
      now: "2026-06-22T10:00:00.000Z",
      appVersion: "1.0.0-rc.2",
      deviceId: "0f9a12be-2c61-4f29-8e36-8f9272aa8f39"
    });

    expect(restore.snapshot.accounts).toHaveLength(source.accounts.length);
    expect(restore.snapshot.outboxOperations).toEqual([]);
    expect(restore.snapshot.conflicts).toEqual([]);
    expect(restore.snapshot.syncState[0]).toMatchObject({
      provider: "drive_appdata",
      status: "synced",
      remoteRevision: 6,
      driveManifestFileId: "manifest-file",
      googleEmail: "person@example.com"
    });
    expect(JSON.stringify(restore.snapshot.settings)).not.toMatch(/access_token|refresh_token/i);
  });

  it("blocks restore when the Drive vault schema is unsupported", () => {
    const inspection = inspectDriveVaultProfile(files, account, {
      manifest: {
        kind: "bluehour-drive-vault-manifest",
        schemaVersion: 999,
        remoteRevision: 2,
        activeSlot: "A",
        files
      },
      activeSlot: "A",
      schemaVersion: 999,
      remoteRevision: 2,
      snapshot: {}
    });

    expect(inspection.profileHealth.status).toBe("unsupported_remote_schema");
    expect(inspection.consistencyErrors.join(" ")).toMatch(/schema is 999/);
    expect(() =>
      prepareDriveVaultRestore({
        inspection,
        now: "2026-06-22T10:00:00.000Z",
        appVersion: "1.0.0-rc.2"
      })
    ).toThrow(/schema is 999/);
  });

  it("allows setup manifest plus one open cycle to restore and repair as live", () => {
    const manifest = createProfileManifest({
      now: "2026-06-22T09:42:00.000Z",
      appVersion: "1.0.0-rc.3",
      lifecycle: "setup",
      onboardingStep: "start_cycle"
    });
    const source = {
      ...createDemoSnapshot(),
      settings: [profileManifestSettingRecord([], manifest)]
    };
    const inspection = inspectDriveVaultProfile(files, account, {
      manifest: {
        kind: "bluehour-drive-vault-manifest",
        schemaVersion: 2,
        remoteRevision: 7,
        activeSlot: "A",
        files
      },
      activeSlot: "A",
      schemaVersion: 2,
      remoteRevision: 7,
      snapshot: snapshotForRemoteVault(source)
    });

    const restore = prepareDriveVaultRestore({
      inspection,
      now: "2026-06-22T10:00:00.000Z",
      appVersion: "1.0.0-rc.4",
      repairAsLive: true
    });

    expect(inspection.consistencyErrors).toEqual([]);
    expect(inspection.profileHealth.canResumeAsLive).toBe(true);
    expect(restore.manifest.lifecycle).toBe("live");
    expect(restore.shell.applicationState).toBe("live");
  });

  it("keeps multiple open cycles in read-only recovery territory", () => {
    const manifest = createProfileManifest({
      now: "2026-06-22T09:42:00.000Z",
      appVersion: "1.0.0-rc.3",
      lifecycle: "live"
    });
    const base = createDemoSnapshot();
    const source = {
      ...base,
      budgetCycles: [base.budgetCycles[0], { ...base.budgetCycles[0], id: "cycle-open-two" } satisfies BudgetCycle],
      settings: [profileManifestSettingRecord([], manifest)]
    };

    const inspection = inspectDriveVaultProfile(files, account, {
      manifest: {
        kind: "bluehour-drive-vault-manifest",
        schemaVersion: 2,
        remoteRevision: 7,
        activeSlot: "A",
        files
      },
      activeSlot: "A",
      schemaVersion: 2,
      remoteRevision: 7,
      snapshot: snapshotForRemoteVault(source)
    });

    expect(inspection.profileHealth.status).toBe("multiple_open_cycles");
    expect(inspection.consistencyErrors.join(" ")).toMatch(/More than one open salary cycle/);

    const restore = prepareDriveVaultReadOnlyRestore({
      inspection,
      now: "2026-06-22T10:00:00.000Z",
      appVersion: "1.0.0-rc.4"
    });

    expect(restore.manifest.lifecycle).toBe("read_only_recovery");
    expect(restore.shell.applicationState).toBe("read_only_recovery");
    expect(restore.snapshot.syncState[0]).toMatchObject({
      provider: "drive_appdata",
      status: "read_only_recovery",
      remoteRevision: 7
    });
  });
});
