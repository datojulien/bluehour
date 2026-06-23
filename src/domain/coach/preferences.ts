import { createRecordMeta, touchRecord } from "../records";
import type { AppSettings } from "../types";

export interface SavingsCoachPreferences {
  enabled: boolean;
  insightSensitivity: "gentle" | "normal" | "strict";
  smallPurchaseThresholdMinor: number;
  smallPurchaseWindowDays: number;
  merchantWatchlist: string[];
  categoryReductionTargets: Array<{
    categoryId: string;
    targetReductionBasisPoints: number;
  }>;
  defaultGoalPriority: "low" | "normal" | "high";
  saveDifferenceDefault: "ask" | "move_all" | "move_half" | "keep_available";
  snoozeDays: number;
}

export const defaultSavingsCoachPreferences: SavingsCoachPreferences = {
  enabled: true,
  insightSensitivity: "normal",
  smallPurchaseThresholdMinor: 2_000,
  smallPurchaseWindowDays: 31,
  merchantWatchlist: [],
  categoryReductionTargets: [],
  defaultGoalPriority: "normal",
  saveDifferenceDefault: "ask",
  snoozeDays: 14
};

export function readSavingsCoachPreferences(settings: readonly AppSettings[]): SavingsCoachPreferences {
  const setting = settings.find((item) => item.key === "preferences" && !item.archivedAt);
  if (!setting) {
    return defaultSavingsCoachPreferences;
  }

  try {
    const value = JSON.parse(setting.valueJson) as { savingsCoach?: Partial<SavingsCoachPreferences> };
    return normalizeSavingsCoachPreferences(value.savingsCoach);
  } catch {
    return defaultSavingsCoachPreferences;
  }
}

export function savingsCoachPreferenceRecord(settings: readonly AppSettings[], next: SavingsCoachPreferences): AppSettings {
  const existing = settings.find((item) => item.key === "preferences" && !item.archivedAt);
  const current = existing ? safeParse(existing.valueJson) : {};
  const valueJson = JSON.stringify({
    ...current,
    savingsCoach: normalizeSavingsCoachPreferences(next)
  });

  return existing
    ? {
        ...touchRecord(existing),
        valueJson
      }
    : {
        ...createRecordMeta("settings"),
        key: "preferences",
        valueJson
      };
}

export function normalizeSavingsCoachPreferences(input?: Partial<SavingsCoachPreferences>): SavingsCoachPreferences {
  const sensitivity = input?.insightSensitivity;
  const defaultAction = input?.saveDifferenceDefault;
  const priority = input?.defaultGoalPriority;
  return {
    enabled: input?.enabled ?? defaultSavingsCoachPreferences.enabled,
    insightSensitivity: sensitivity === "gentle" || sensitivity === "strict" || sensitivity === "normal" ? sensitivity : "normal",
    smallPurchaseThresholdMinor:
      input?.smallPurchaseThresholdMinor && input.smallPurchaseThresholdMinor > 0
        ? input.smallPurchaseThresholdMinor
        : defaultSavingsCoachPreferences.smallPurchaseThresholdMinor,
    smallPurchaseWindowDays:
      input?.smallPurchaseWindowDays && input.smallPurchaseWindowDays > 0
        ? input.smallPurchaseWindowDays
        : defaultSavingsCoachPreferences.smallPurchaseWindowDays,
    merchantWatchlist: [...(input?.merchantWatchlist ?? [])].filter(Boolean).slice(0, 20),
    categoryReductionTargets: [...(input?.categoryReductionTargets ?? [])].filter((target) => target.targetReductionBasisPoints > 0),
    defaultGoalPriority: priority === "low" || priority === "high" || priority === "normal" ? priority : "normal",
    saveDifferenceDefault:
      defaultAction === "move_all" || defaultAction === "move_half" || defaultAction === "keep_available" || defaultAction === "ask"
        ? defaultAction
        : "ask",
    snoozeDays: input?.snoozeDays && input.snoozeDays > 0 ? input.snoozeDays : defaultSavingsCoachPreferences.snoozeDays
  };
}

function safeParse(valueJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(valueJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
