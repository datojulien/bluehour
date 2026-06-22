import { describe, expect, it } from "vitest";
import { createProfileManifest, profileManifestSettingRecord } from "../../domain/profileManifest";
import type { AppSettings, BluehourSnapshot, BudgetCycle, SyncState } from "../../domain/types";
import type { ShellState } from "../../data/local-db/shellDb";
import { deriveApplicationState, reconcileShellStateForSnapshot } from "./BluehourDataProvider";

const now = "2026-06-23T00:00:00.000Z";

describe("Bluehour application state", () => {
  it("keeps onboarding visible when Google needs reconnection", () => {
    expect(deriveApplicationState("setup", needsReconnection())).toBe("setup");
    expect(deriveApplicationState("ready_for_salary", needsReconnection())).toBe("ready_for_salary");
  });

  it("still exposes Google reconnection as a live-profile route state after setup is complete", () => {
    expect(deriveApplicationState("live", needsReconnection())).toBe("needs_google_reconnection");
  });

  it("resumes manifest onboarding when a stale live shell has no open salary cycle", () => {
    const manifest = createProfileManifest({
      now,
      appVersion: "1.0.0-rc.1",
      lifecycle: "setup",
      onboardingStep: "preferences"
    });
    const snapshot = emptySnapshot([profileManifestSettingRecord([], manifest)]);

    expect(reconcileShellStateForSnapshot(liveShell(), snapshot)).toEqual({
      applicationState: "setup",
      onboardingStep: "preferences"
    });
  });

  it("sends an invalid live profile without an open cycle back to the first-cycle step", () => {
    const manifest = createProfileManifest({
      now,
      appVersion: "1.0.0-rc.1",
      lifecycle: "live"
    });
    const snapshot = emptySnapshot([profileManifestSettingRecord([], manifest)]);

    expect(reconcileShellStateForSnapshot(liveShell(), snapshot)).toEqual({
      applicationState: "ready_for_salary",
      onboardingStep: "start_cycle"
    });
  });

  it("keeps a live shell when an open salary cycle exists", () => {
    const snapshot = {
      ...emptySnapshot(),
      budgetCycles: [openCycle()]
    };

    expect(reconcileShellStateForSnapshot(liveShell(), snapshot)).toBeNull();
  });
});

function needsReconnection(): SyncState {
  return {
    key: "google",
    provider: "drive_appdata",
    status: "needs_reconnection",
    message: "Session expired."
  };
}

function liveShell(): ShellState {
  return {
    key: "state",
    activeProfile: "live",
    applicationState: "live",
    onboardingStep: "start_cycle",
    legacyDatabaseDetected: false,
    updatedAt: now
  };
}

function openCycle(): BudgetCycle {
  return {
    id: "cycle-open",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    revision: 1,
    startedOn: "2026-06-23",
    status: "open",
    salaryTransactionId: "txn-salary",
    expectedNextSalaryFrom: "2026-07-23",
    expectedNextSalaryTo: "2026-07-25",
    protectedRateBasisPoints: 1_000,
    bufferMinimumMinor: 50_000,
    bufferEssentialRateBasisPoints: 1_000,
    actualMainSalaryMinor: 780_000
  };
}

function emptySnapshot(settings: AppSettings[] = []): BluehourSnapshot {
  return {
    accounts: [],
    balanceSnapshots: [],
    transactions: [],
    transactionLegs: [],
    transactionSplits: [],
    categories: [],
    budgetCycles: [],
    budgetAllocations: [],
    budgetTransfers: [],
    recurringRules: [],
    planInstances: [],
    subscriptions: [],
    categorisationRules: [],
    importProfiles: [],
    importBatches: [],
    importRowAudits: [],
    reconciliations: [],
    reviewSessions: [],
    settings,
    outboxOperations: [],
    conflicts: [],
    syncState: []
  };
}
