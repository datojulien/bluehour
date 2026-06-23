import type { Category, UtcIsoTimestamp } from "../types";

export type StarterCategoryDefinition = Pick<Category, "id" | "name" | "group" | "nature" | "reservationMode" | "sortOrder">;

export const DISCRETIONARY_ENVELOPE_CATEGORY_IDS = [
  "cat-dining",
  "cat-entertainment",
  "cat-shopping",
  "cat-hobbies",
  "cat-gifts",
  "cat-travel",
  "cat-miscellaneous"
] as const;

export const STARTER_CATEGORY_DEFINITIONS: StarterCategoryDefinition[] = [
  { id: "cat-housing", name: "Housing", group: "committed", nature: "essential", reservationMode: "plan", sortOrder: 10 },
  { id: "cat-utilities", name: "Utilities", group: "committed", nature: "essential", reservationMode: "plan", sortOrder: 20 },
  { id: "cat-internet-mobile", name: "Internet & Mobile", group: "committed", nature: "essential", reservationMode: "plan", sortOrder: 30 },
  { id: "cat-insurance", name: "Insurance", group: "committed", nature: "essential", reservationMode: "plan", sortOrder: 40 },
  { id: "cat-subscriptions", name: "Subscriptions", group: "committed", nature: "discretionary", reservationMode: "plan", sortOrder: 50 },
  { id: "cat-debt", name: "Debt & Contractual Payments", group: "committed", nature: "essential", reservationMode: "plan", sortOrder: 60 },
  { id: "cat-fixed-transport", name: "Fixed Transport", group: "committed", nature: "essential", reservationMode: "plan", sortOrder: 70 },
  { id: "cat-groceries", name: "Groceries", group: "essential_flexible", nature: "essential", reservationMode: "envelope", sortOrder: 110 },
  { id: "cat-fuel", name: "Fuel", group: "essential_flexible", nature: "essential", reservationMode: "envelope", sortOrder: 120 },
  { id: "cat-transport", name: "Transport", group: "essential_flexible", nature: "essential", reservationMode: "envelope", sortOrder: 130 },
  { id: "cat-medical", name: "Medical", group: "essential_flexible", nature: "essential", reservationMode: "envelope", sortOrder: 140 },
  { id: "cat-tolls-parking", name: "Tolls & Parking", group: "essential_flexible", nature: "essential", reservationMode: "envelope", sortOrder: 145 },
  { id: "cat-household", name: "Household", group: "essential_flexible", nature: "essential", reservationMode: "envelope", sortOrder: 150 },
  { id: "cat-essential-personal-care", name: "Essential Personal Care", group: "essential_flexible", nature: "essential", reservationMode: "envelope", sortOrder: 160 },
  { id: "cat-dining", name: "Dining Out", group: "discretionary", nature: "discretionary", reservationMode: "envelope", sortOrder: 210 },
  { id: "cat-entertainment", name: "Entertainment", group: "discretionary", nature: "discretionary", reservationMode: "envelope", sortOrder: 220 },
  { id: "cat-shopping", name: "Shopping", group: "discretionary", nature: "discretionary", reservationMode: "envelope", sortOrder: 230 },
  { id: "cat-travel", name: "Travel", group: "discretionary", nature: "discretionary", reservationMode: "envelope", sortOrder: 240 },
  { id: "cat-hobbies", name: "Hobbies", group: "discretionary", nature: "discretionary", reservationMode: "envelope", sortOrder: 250 },
  { id: "cat-gifts", name: "Gifts", group: "discretionary", nature: "discretionary", reservationMode: "envelope", sortOrder: 260 },
  { id: "cat-miscellaneous", name: "Miscellaneous", group: "discretionary", nature: "discretionary", reservationMode: "envelope", sortOrder: 270 },
  { id: "cat-savings", name: "Savings", group: "protected", nature: "protected", reservationMode: "protected", sortOrder: 310 },
  { id: "cat-investments", name: "Investments", group: "protected", nature: "protected", reservationMode: "protected", sortOrder: 320 },
  { id: "cat-planned-major-payments", name: "Planned Major Payments", group: "protected", nature: "protected", reservationMode: "protected", sortOrder: 330 },
  { id: "cat-income", name: "Income", group: "administrative", nature: "administrative", reservationMode: "none", sortOrder: 410 },
  { id: "cat-transfers", name: "Transfers", group: "administrative", nature: "administrative", reservationMode: "none", sortOrder: 420 },
  { id: "cat-reconciliation", name: "Reconciliation", group: "administrative", nature: "administrative", reservationMode: "none", sortOrder: 430 },
  { id: "cat-uncategorised", name: "Uncategorised", group: "administrative", nature: "administrative", reservationMode: "none", sortOrder: 440 },
  { id: "cat-bank-fees", name: "Bank Fees", group: "administrative", nature: "administrative", reservationMode: "none", sortOrder: 450 },
  { id: "cat-taxes", name: "Taxes", group: "administrative", nature: "administrative", reservationMode: "none", sortOrder: 460 }
];

export function createStarterCategories(now: UtcIsoTimestamp): Category[] {
  return STARTER_CATEGORY_DEFINITIONS.map((category) => ({
    ...category,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    revision: 1,
    active: true
  }));
}
