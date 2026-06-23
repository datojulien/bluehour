import { touchRecord } from "../records";
import type { Category, UtcIsoTimestamp } from "../types";
import { DISCRETIONARY_ENVELOPE_CATEGORY_IDS, STARTER_CATEGORY_DEFINITIONS, type StarterCategoryDefinition } from "./starterCategories";

const SYSTEM_CATEGORY_IDS = new Set(["cat-income", "cat-transfers", "cat-reconciliation", "cat-uncategorised"]);
const DISCRETIONARY_ENVELOPE_IDS = new Set<string>(DISCRETIONARY_ENVELOPE_CATEGORY_IDS);

export interface CategoryConfigurationResult {
  valid: boolean;
  warning?: string;
  error?: string;
}

export interface StarterCategoryReconciliation {
  categories: Category[];
  addedIds: string[];
  updatedIds: string[];
}

export function isSystemCategory(categoryId: string): boolean {
  return SYSTEM_CATEGORY_IDS.has(categoryId);
}

export function validateCategoryConfiguration(category: Pick<Category, "group" | "nature" | "reservationMode">): CategoryConfigurationResult {
  if (category.group === "administrative" && category.reservationMode !== "none") {
    return { valid: false, error: "Administrative categories do not reserve money and must use none." };
  }

  if (category.nature === "administrative" && category.group !== "administrative") {
    return { valid: false, error: "Administrative nature is only valid for administrative categories." };
  }

  if (category.reservationMode === "protected" && category.nature !== "protected") {
    return { valid: false, error: "Only protected categories can use protected reservation mode." };
  }

  if (category.nature === "protected" && category.reservationMode !== "protected") {
    return { valid: false, error: "Protected categories must reserve through protected mode." };
  }

  if ((category.group === "essential_flexible" || category.group === "discretionary") && category.reservationMode === "none") {
    return { valid: false, error: "Budget categories need an envelope or plan mode so allocations remain visible." };
  }

  if (category.group === "committed" && category.reservationMode !== "plan") {
    return { valid: true, warning: "Committed categories normally use plan mode because they are reserved from dated obligations." };
  }

  if ((category.group === "essential_flexible" || category.group === "discretionary") && category.reservationMode !== "envelope") {
    return { valid: true, warning: "Flexible budget categories normally use envelope mode so allocations remain in the salary cycle." };
  }

  return { valid: true };
}

export function reconcileStarterCategories(
  categories: readonly Category[],
  now: UtcIsoTimestamp,
  definitions: readonly StarterCategoryDefinition[] = STARTER_CATEGORY_DEFINITIONS
): StarterCategoryReconciliation {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const existingNames = new Map(categories.map((category) => [normaliseName(category.name), category]));
  const next = [...categories];
  const addedIds: string[] = [];
  const updatedIds: string[] = [];

  for (const definition of definitions) {
    const existing = byId.get(definition.id);

    if (existing) {
      if (DISCRETIONARY_ENVELOPE_IDS.has(existing.id) && existing.reservationMode === "none") {
        const updated = {
          ...touchRecord(existing),
          reservationMode: "envelope" as const
        };
        replaceCategory(next, updated);
        updatedIds.push(existing.id);
      }
      continue;
    }

    const sameName = existingNames.get(normaliseName(definition.name));
    if (sameName && sameName.id !== definition.id) {
      continue;
    }

    const created: Category = {
      ...definition,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      revision: 1,
      active: true
    };
    next.push(created);
    byId.set(created.id, created);
    existingNames.set(normaliseName(created.name), created);
    addedIds.push(created.id);
  }

  return {
    categories: next,
    addedIds,
    updatedIds
  };
}

export function moveCategory(categories: readonly Category[], categoryId: string, direction: "up" | "down", now: UtcIsoTimestamp): Category[] {
  const sorted = [...categories].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
  const index = sorted.findIndex((category) => category.id === categoryId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;

  if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) {
    return [...categories];
  }

  const current = sorted[index];
  const target = sorted[targetIndex];
  const currentOrder = current.sortOrder;
  const movedCurrent = { ...touchRecord(current), updatedAt: now, sortOrder: target.sortOrder };
  const movedTarget = { ...touchRecord(target), updatedAt: now, sortOrder: currentOrder };
  return categories.map((category) => {
    if (category.id === movedCurrent.id) {
      return movedCurrent;
    }
    if (category.id === movedTarget.id) {
      return movedTarget;
    }
    return category;
  });
}

function replaceCategory(categories: Category[], updated: Category): void {
  const index = categories.findIndex((category) => category.id === updated.id);
  if (index >= 0) {
    categories[index] = updated;
  }
}

function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
