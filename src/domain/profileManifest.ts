import { z } from "zod";
import { createRecordMeta, touchRecord } from "./records";
import type { AppSettings, BluehourSnapshot, CurrencyCode, UtcIsoTimestamp } from "./types";

export const PROFILE_MANIFEST_SETTING_KEY = "profileManifest";
export const PROFILE_MANIFEST_VERSION = 1;

export type RemoteProfileLifecycle = "setup" | "ready_for_salary" | "live" | "read_only_recovery";

export type ManifestOnboardingStep =
  | "google"
  | "preferences"
  | "accounts"
  | "income"
  | "obligations"
  | "budget"
  | "wait_salary"
  | "start_cycle";

export interface BluehourProfileManifest {
  manifestVersion: number;
  profileId: string;
  profileName: string;
  currency: CurrencyCode;
  lifecycle: RemoteProfileLifecycle;
  onboardingStep?: ManifestOnboardingStep;
  createdAt: UtcIsoTimestamp;
  updatedAt: UtcIsoTimestamp;
  createdByAppVersion: string;
  updatedByAppVersion?: string;
  lastWrittenByDeviceId?: string;
}

export interface LegacyLifecycleInference {
  lifecycle: RemoteProfileLifecycle;
  onboardingStep?: ManifestOnboardingStep;
  confidence: "likely" | "uncertain";
  evidence: string[];
  warnings: string[];
}

export const manifestOnboardingSteps = [
  "google",
  "preferences",
  "accounts",
  "income",
  "obligations",
  "budget",
  "wait_salary",
  "start_cycle"
] as const satisfies readonly ManifestOnboardingStep[];

export const profileManifestSchema = z
  .object({
    manifestVersion: z.literal(PROFILE_MANIFEST_VERSION),
    profileId: z.string().uuid(),
    profileName: z.string().min(1),
    currency: z.literal("MYR"),
    lifecycle: z.enum(["setup", "ready_for_salary", "live", "read_only_recovery"]),
    onboardingStep: z.enum(manifestOnboardingSteps).optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    createdByAppVersion: z.string().min(1),
    updatedByAppVersion: z.string().min(1).optional(),
    lastWrittenByDeviceId: z.string().uuid().optional()
  })
  .superRefine((manifest, context) => {
    if (manifest.lifecycle === "live" && manifest.onboardingStep) {
      context.addIssue({
        code: "custom",
        path: ["onboardingStep"],
        message: "Live manifests must not keep an onboarding step"
      });
    }

    if (manifest.lifecycle !== "live" && !manifest.onboardingStep && manifest.lifecycle !== "read_only_recovery") {
      context.addIssue({
        code: "custom",
        path: ["onboardingStep"],
        message: "Setup manifests must include the next onboarding step"
      });
    }
  });

export function createProfileManifest({
  now,
  appVersion,
  deviceId,
  profileName = "Personal finances",
  lifecycle = "setup",
  onboardingStep = "google"
}: {
  now: UtcIsoTimestamp;
  appVersion: string;
  deviceId?: string;
  profileName?: string;
  lifecycle?: RemoteProfileLifecycle;
  onboardingStep?: ManifestOnboardingStep;
}): BluehourProfileManifest {
  return profileManifestSchema.parse({
    manifestVersion: PROFILE_MANIFEST_VERSION,
    profileId: crypto.randomUUID(),
    profileName,
    currency: "MYR",
    lifecycle,
    onboardingStep: lifecycle === "live" ? undefined : onboardingStep,
    createdAt: now,
    updatedAt: now,
    createdByAppVersion: appVersion,
    updatedByAppVersion: appVersion,
    lastWrittenByDeviceId: deviceId
  });
}

export function parseProfileManifest(value: unknown): BluehourProfileManifest {
  return profileManifestSchema.parse(value);
}

export function parseProfileManifestJson(valueJson: string): BluehourProfileManifest {
  return parseProfileManifest(JSON.parse(valueJson));
}

export function readProfileManifest(settings: readonly AppSettings[]): BluehourProfileManifest | null {
  const setting = activeProfileManifestSetting(settings);
  return setting ? parseProfileManifestJson(setting.valueJson) : null;
}

export function profileManifestSettingRecord(settings: readonly AppSettings[], manifest: BluehourProfileManifest): AppSettings {
  const valueJson = JSON.stringify(profileManifestSchema.parse(manifest));
  const existing = activeProfileManifestSetting(settings);
  return existing
    ? {
        ...touchRecord(existing),
        valueJson
      }
    : {
        ...createRecordMeta("settings"),
        key: PROFILE_MANIFEST_SETTING_KEY,
        valueJson
      };
}

export function nextManifestForCheckpoint({
  current,
  now,
  appVersion,
  deviceId,
  lifecycle,
  onboardingStep
}: {
  current: BluehourProfileManifest;
  now: UtcIsoTimestamp;
  appVersion: string;
  deviceId?: string;
  lifecycle: RemoteProfileLifecycle;
  onboardingStep?: ManifestOnboardingStep;
}): BluehourProfileManifest {
  return profileManifestSchema.parse({
    ...current,
    lifecycle,
    onboardingStep: lifecycle === "live" ? undefined : onboardingStep,
    updatedAt: now,
    updatedByAppVersion: appVersion,
    lastWrittenByDeviceId: deviceId
  });
}

export function manifestCheckpointForShell(
  onboardingStep: ManifestOnboardingStep,
  applicationState: "setup" | "ready_for_salary" | "live" | "read_only_recovery" = "setup"
): { lifecycle: RemoteProfileLifecycle; onboardingStep?: ManifestOnboardingStep } {
  if (applicationState === "live") {
    return { lifecycle: "live" };
  }

  if (applicationState === "ready_for_salary") {
    return { lifecycle: "ready_for_salary", onboardingStep: "start_cycle" };
  }

  if (applicationState === "read_only_recovery") {
    return { lifecycle: "read_only_recovery" };
  }

  return { lifecycle: "setup", onboardingStep };
}

export function shellStateFromManifest(manifest: BluehourProfileManifest): {
  applicationState: "setup" | "ready_for_salary" | "live" | "read_only_recovery";
  onboardingStep: ManifestOnboardingStep;
} {
  if (manifest.lifecycle === "live") {
    return { applicationState: "live", onboardingStep: "start_cycle" };
  }

  if (manifest.lifecycle === "ready_for_salary") {
    return { applicationState: "ready_for_salary", onboardingStep: "start_cycle" };
  }

  if (manifest.lifecycle === "read_only_recovery") {
    return { applicationState: "read_only_recovery", onboardingStep: manifest.onboardingStep ?? "google" };
  }

  return { applicationState: "setup", onboardingStep: manifest.onboardingStep ?? "google" };
}

export function validateManifestAgainstSnapshot(manifest: BluehourProfileManifest, snapshot: Pick<BluehourSnapshot, "budgetCycles">): string[] {
  const activeCycles = snapshot.budgetCycles.filter((cycle) => !cycle.archivedAt && cycle.status !== "closed");
  const allCycles = snapshot.budgetCycles.filter((cycle) => !cycle.archivedAt);
  const errors: string[] = [];

  if (manifest.lifecycle === "live" && allCycles.length === 0) {
    errors.push("Profile manifest says this profile is live, but no salary cycle exists.");
  }

  if ((manifest.lifecycle === "setup" || manifest.lifecycle === "ready_for_salary") && activeCycles.length > 0) {
    errors.push("Profile manifest says onboarding is still in progress, but an active salary cycle already exists.");
  }

  if (manifest.lifecycle === "ready_for_salary" && manifest.onboardingStep !== "start_cycle") {
    errors.push("Ready-for-salary manifests must resume at the start-cycle step.");
  }

  return errors;
}

export function inferLegacyLifecycle(snapshot: Pick<BluehourSnapshot, "accounts" | "budgetCycles" | "planInstances" | "settings">): LegacyLifecycleInference {
  const activeCycles = snapshot.budgetCycles.filter((cycle) => !cycle.archivedAt && cycle.status !== "closed");
  if (activeCycles.length > 0) {
    return {
      lifecycle: "live",
      confidence: "likely",
      evidence: ["An open or setup salary cycle exists."],
      warnings: ["Legacy Sheets do not contain a synced profile manifest. Confirm before this device writes a manifest back."]
    };
  }

  if (snapshot.accounts.some((account) => !account.archivedAt) || snapshot.planInstances.some((plan) => !plan.archivedAt)) {
    return {
      lifecycle: "setup",
      onboardingStep: "accounts",
      confidence: "uncertain",
      evidence: ["Accounts or onboarding plans exist, but no open salary cycle was found."],
      warnings: ["The exact onboarding step cannot be inferred confidently from this legacy Sheet."]
    };
  }

  if (snapshot.settings.some((setting) => setting.key === "preferences" && !setting.archivedAt)) {
    return {
      lifecycle: "setup",
      onboardingStep: "accounts",
      confidence: "uncertain",
      evidence: ["Preferences exist, but there are no accounts, plans, or salary cycles."],
      warnings: ["This looks like early setup. Confirm the resume point before writing a manifest."]
    };
  }

  return {
    lifecycle: "setup",
    onboardingStep: "google",
    confidence: "uncertain",
    evidence: ["No meaningful live records were found."],
    warnings: ["This Sheet may be empty or incomplete."]
  };
}

export function hasMeaningfulProfileData(snapshot: Pick<BluehourSnapshot, "accounts" | "transactions" | "budgetCycles" | "planInstances" | "subscriptions" | "budgetAllocations">): boolean {
  return [
    snapshot.accounts,
    snapshot.transactions,
    snapshot.budgetCycles,
    snapshot.planInstances,
    snapshot.subscriptions,
    snapshot.budgetAllocations
  ].some((records) => records.some((record) => !record.archivedAt));
}

export function activeProfileManifestSetting(settings: readonly AppSettings[]): AppSettings | undefined {
  return settings.find((setting) => setting.key === PROFILE_MANIFEST_SETTING_KEY && !setting.archivedAt);
}
