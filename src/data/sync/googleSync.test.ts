import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "../../test/fixtures/demoData";
import type { RemoteSheetSnapshot } from "../google/sheetSerialization";
import { planGoogleSheetSync } from "./googleSync";
import { createProfileManifest, profileManifestSettingRecord } from "../../domain/profileManifest";

describe("Google Sheet sync planner", () => {
  it("pushes local data when the remote Sheet is empty", () => {
    const local = createDemoSnapshot();
    const plan = planGoogleSheetSync(local, { remoteRevision: 0, snapshot: {} });

    expect(plan.action).toBe("push_local");
    expect(plan.nextRemoteRevision).toBe(1);
  });

  it("does nothing when revisions match and the outbox is empty", () => {
    const local = {
      ...createDemoSnapshot(),
      syncState: [{ key: "google" as const, status: "synced" as const, remoteRevision: 4 }]
    };
    const plan = planGoogleSheetSync(local, { remoteRevision: 4, snapshot: {} });

    expect(plan.action).toBe("no_op");
    expect(plan.clearOutbox).toBe(false);
  });

  it("applies remote records when the Sheet advanced and local did not edit them", () => {
    const local = {
      ...createDemoSnapshot(),
      syncState: [{ key: "google" as const, status: "synced" as const, remoteRevision: 4 }]
    };
    const remoteAccount = { ...local.accounts[0], name: "Remote renamed account", revision: 2 };
    const remote: RemoteSheetSnapshot = {
      remoteRevision: 5,
      snapshot: {
        accounts: [remoteAccount]
      }
    };
    const plan = planGoogleSheetSync(local, remote);

    expect(plan.action).toBe("apply_remote");
    expect(plan.mutations[0]).toMatchObject({
      storeName: "accounts",
      record: remoteAccount
    });
  });

  it("creates conflicts when local outbox and remote changed the same record", () => {
    const base = createDemoSnapshot();
    const localAccount = { ...base.accounts[0], name: "Local renamed account", revision: 2 };
    const local = {
      ...base,
      accounts: [localAccount, ...base.accounts.slice(1)],
      outboxOperations: [
        {
          id: "outbox-1",
          tableName: "accounts",
          recordId: localAccount.id,
          operation: "put" as const,
          payloadJson: JSON.stringify(localAccount),
          createdAt: "2026-07-12T00:00:00.000Z",
          attempts: 0
        }
      ],
      syncState: [{ key: "google" as const, status: "synced" as const, remoteRevision: 4 }]
    };
    const remote: RemoteSheetSnapshot = {
      remoteRevision: 5,
      snapshot: {
        accounts: [{ ...base.accounts[0], name: "Remote renamed account", revision: 2 }]
      }
    };
    const plan = planGoogleSheetSync(local, remote);

    expect(plan.action).toBe("conflict");
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({
      tableName: "accounts",
      recordId: localAccount.id,
      status: "open"
    });
  });

  it("enters read-only recovery when the remote schema is newer than this build", () => {
    const local = createDemoSnapshot();
    const plan = planGoogleSheetSync(local, {
      remoteRevision: 5,
      schemaVersion: 999,
      snapshot: {}
    });

    expect(plan.action).toBe("read_only_recovery");
    expect(plan.syncState.status).toBe("read_only_recovery");
  });

  it("blocks automatic sync when profile IDs differ", () => {
    const localManifest = createProfileManifest({ now: "2026-06-22T00:00:00.000Z", appVersion: "1.0.0-rc.2" });
    const remoteManifest = createProfileManifest({ now: "2026-06-22T00:00:00.000Z", appVersion: "1.0.0-rc.2" });
    const base = createDemoSnapshot();
    const local = {
      ...base,
      settings: [profileManifestSettingRecord([], localManifest)],
      syncState: [{ key: "google" as const, status: "synced" as const, remoteRevision: 4 }]
    };
    const remote: RemoteSheetSnapshot = {
      remoteRevision: 5,
      snapshot: {
        settings: [profileManifestSettingRecord([], remoteManifest)]
      }
    };
    const plan = planGoogleSheetSync(local, remote);

    expect(plan.action).toBe("cross_profile_blocked");
    expect(plan.syncState.status).toBe("failed");
  });

  it("permits sync planning when profile IDs match", () => {
    const manifest = createProfileManifest({ now: "2026-06-22T00:00:00.000Z", appVersion: "1.0.0-rc.2" });
    const base = createDemoSnapshot();
    const local = {
      ...base,
      settings: [profileManifestSettingRecord([], manifest)],
      syncState: [{ key: "google" as const, status: "synced" as const, remoteRevision: 4 }]
    };
    const remote: RemoteSheetSnapshot = {
      remoteRevision: 5,
      snapshot: {
        accounts: [{ ...base.accounts[0], name: "Remote account" }],
        settings: [profileManifestSettingRecord([], manifest)]
      }
    };
    const plan = planGoogleSheetSync(local, remote);

    expect(plan.action).toBe("apply_remote");
  });
});
