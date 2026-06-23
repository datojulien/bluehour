import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "../test/fixtures/demoData";
import { createProfileManifest, profileManifestSettingRecord, readProfileManifest } from "./profileManifest";
import {
  inspectProfileHealth,
  liveManifestRepairRecord,
  onboardingManifestRepairRecord,
  planAccidentalOpenCycleArchive
} from "./profileHealth";
import type { AppSettings, BluehourSnapshot, BudgetCycle } from "./types";

const now = "2026-06-23T00:00:00.000Z";

describe("profile health", () => {
  it("treats setup manifests with no cycle as healthy", () => {
    const manifest = manifestFor("setup", "accounts");
    const snapshot = emptySnapshot([profileManifestSettingRecord([], manifest)]);

    const health = inspectProfileHealth({ snapshot, manifest });

    expect(health.status).toBe("healthy");
    expect(health.openCycleCount).toBe(0);
  });

  it("treats ready-for-salary manifests without an open cycle as healthy", () => {
    const manifest = manifestFor("ready_for_salary", "start_cycle");
    const snapshot = emptySnapshot([profileManifestSettingRecord([], manifest)]);

    expect(inspectProfileHealth({ snapshot, manifest }).status).toBe("healthy");
  });

  it("treats live manifests with one open cycle as healthy", () => {
    const snapshot = createDemoSnapshot();
    const manifest = manifestFor("live");
    const health = inspectProfileHealth({ snapshot: withManifest(snapshot, manifest), manifest });

    expect(health.status).toBe("healthy");
    expect(health.canArchiveAccidentalCycle).toBe(false);
  });

  it("repairs setup manifest plus one open cycle by resuming as live", () => {
    const snapshot = createDemoSnapshot();
    const setupManifest = manifestFor("setup", "start_cycle");
    const health = inspectProfileHealth({ snapshot: withManifest(snapshot, setupManifest), manifest: setupManifest });
    const record = liveManifestRepairRecord({
      settings: snapshot.settings,
      manifest: setupManifest,
      now,
      appVersion: "1.0.0-rc.4",
      deviceId: "0f9a12be-2c61-4f29-8e36-8f9272aa8f39"
    });
    const repaired = readProfileManifest([record]);

    expect(health.status).toBe("manifest_onboarding_but_cycle_open");
    expect(health.canResumeAsLive).toBe(true);
    expect(health.canArchiveAccidentalCycle).toBe(true);
    expect(repaired?.lifecycle).toBe("live");
    expect(repaired?.onboardingStep).toBeUndefined();
  });

  it("repairs ready-for-salary manifest plus one open cycle by resuming as live", () => {
    const snapshot = createDemoSnapshot();
    const manifest = manifestFor("ready_for_salary", "start_cycle");
    const health = inspectProfileHealth({ snapshot: withManifest(snapshot, manifest), manifest });

    expect(health.status).toBe("ready_for_salary_but_cycle_open");
    expect(health.canResumeAsLive).toBe(true);
  });

  it("flags live manifest with no salary-cycle history", () => {
    const manifest = manifestFor("live");
    const snapshot = emptySnapshot([profileManifestSettingRecord([], manifest)]);

    const health = inspectProfileHealth({ snapshot, manifest });

    expect(health.status).toBe("manifest_live_but_no_cycle");
    expect(health.issues[0]?.repairOptions).toContain("resume_onboarding");
  });

  it("reports missing manifest with no meaningful data", () => {
    const health = inspectProfileHealth({ snapshot: emptySnapshot(), manifest: null });

    expect(health.status).toBe("manifest_missing");
    expect(health.meaningfulData).toBe(false);
  });

  it("reports missing manifest with meaningful setup data", () => {
    const snapshot = { ...emptySnapshot(), accounts: createDemoSnapshot().accounts.slice(0, 1) };

    const health = inspectProfileHealth({ snapshot, manifest: null });

    expect(health.status).toBe("manifest_missing");
    expect(health.meaningfulData).toBe(true);
  });

  it("reports missing manifest with one open cycle as repairable live", () => {
    const snapshot = { ...emptySnapshot(), budgetCycles: [openCycle("cycle-open")] };

    const health = inspectProfileHealth({ snapshot, manifest: null });

    expect(health.status).toBe("manifest_missing");
    expect(health.canResumeAsLive).toBe(true);
  });

  it("flags multiple open cycles and refuses automatic live repair", () => {
    const snapshot = { ...createDemoSnapshot(), budgetCycles: [openCycle("cycle-a"), openCycle("cycle-b")] };
    const manifest = manifestFor("setup", "start_cycle");

    const health = inspectProfileHealth({ snapshot, manifest });

    expect(health.status).toBe("multiple_open_cycles");
    expect(health.canResumeAsLive).toBe(false);
  });

  it("ignores archived open cycles", () => {
    const manifest = manifestFor("ready_for_salary", "start_cycle");
    const snapshot = {
      ...emptySnapshot([profileManifestSettingRecord([], manifest)]),
      budgetCycles: [{ ...openCycle("cycle-archived"), archivedAt: now }]
    };

    expect(inspectProfileHealth({ snapshot, manifest }).openCycleCount).toBe(0);
    expect(inspectProfileHealth({ snapshot, manifest }).status).toBe("healthy");
  });

  it("counts closed cycles as financial history but not open cycles", () => {
    const manifest = manifestFor("live");
    const snapshot = {
      ...emptySnapshot([profileManifestSettingRecord([], manifest)]),
      budgetCycles: [{ ...openCycle("cycle-closed"), status: "closed" as const, endedOn: "2026-07-22" as const, closedAt: now }]
    };

    const health = inspectProfileHealth({ snapshot, manifest });

    expect(health.openCycleCount).toBe(0);
    expect(health.closedCycleCount).toBe(1);
    expect(health.status).toBe("healthy");
  });

  it("detects shell and manifest mismatch", () => {
    const manifest = manifestFor("live");
    const snapshot = withManifest(createDemoSnapshot(), manifest);

    const health = inspectProfileHealth({
      snapshot,
      manifest,
      shell: { applicationState: "setup", onboardingStep: "start_cycle" }
    });

    expect(health.issues.map((issue) => issue.id)).toContain("shell_manifest_mismatch");
  });

  it("keeps unsupported remote schema in read-only repair territory", () => {
    const manifest = manifestFor("live");
    const health = inspectProfileHealth({
      snapshot: withManifest(createDemoSnapshot(), manifest),
      manifest,
      remoteSchemaVersion: 999,
      supportedRemoteSchemaVersion: 2
    });

    expect(health.status).toBe("unsupported_remote_schema");
    expect(health.issues[0]?.repairOptions).toContain("enter_read_only_recovery");
  });

  it("can build an onboarding manifest repair after archiving an accidental cycle", () => {
    const manifest = manifestFor("live");
    const record = onboardingManifestRepairRecord({
      settings: [],
      manifest,
      now,
      appVersion: "1.0.0-rc.4",
      lifecycle: "ready_for_salary",
      onboardingStep: "start_cycle"
    });

    expect(readProfileManifest([record])?.lifecycle).toBe("ready_for_salary");
  });

  it("identifies records created by the first-cycle command for explicit archive repair", () => {
    const snapshot = createDemoSnapshot();

    const plan = planAccidentalOpenCycleArchive(snapshot, now);

    expect(plan.safe).toBe(true);
    expect(plan.records.budgetCycles).toHaveLength(1);
    expect(plan.records.transactions[0]?.id).toBe(snapshot.budgetCycles[0].salaryTransactionId);
    expect(plan.records.budgetAllocations.length).toBeGreaterThan(0);
  });

  it("refuses accidental cycle archive when records are ambiguous", () => {
    const snapshot = { ...createDemoSnapshot(), transactions: [] };

    const plan = planAccidentalOpenCycleArchive(snapshot, now);

    expect(plan.safe).toBe(false);
    expect(plan.reason).toMatch(/salary transaction/i);
  });
});

function manifestFor(lifecycle: "setup" | "ready_for_salary" | "live", onboardingStep?: "accounts" | "start_cycle") {
  return createProfileManifest({
    now,
    appVersion: "1.0.0-rc.4",
    lifecycle,
    onboardingStep
  });
}

function withManifest(snapshot: BluehourSnapshot, manifest: ReturnType<typeof manifestFor>): BluehourSnapshot {
  return {
    ...snapshot,
    settings: [...snapshot.settings.filter((setting) => setting.key !== "profileManifest"), profileManifestSettingRecord([], manifest)]
  };
}

function openCycle(id: string): BudgetCycle {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    revision: 1,
    startedOn: "2026-06-23",
    status: "open",
    salaryTransactionId: `txn-${id}`,
    expectedNextSalaryFrom: "2026-07-24",
    expectedNextSalaryTo: "2026-07-26",
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
    extraIncomeAllocations: [],
    savingsGoals: [],
    savingsGoalContributions: [],
    coachInsightDecisions: [],
    purchaseChecks: [],
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
