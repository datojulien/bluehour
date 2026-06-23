import { describe, expect, it } from "vitest";
import type { Category } from "../types";
import { reconcileStarterCategories, validateCategoryConfiguration, moveCategory } from "./categoryManagement";

const now = "2026-07-12T00:00:00.000Z";

describe("category management", () => {
  it("migrates built-in discretionary categories from none to envelope without renaming them", () => {
    const categories = [
      category("cat-dining", "Meals Out", "discretionary", "discretionary", "none", 10),
      category("cat-transfers", "Transfers", "administrative", "administrative", "none", 20)
    ];
    const result = reconcileStarterCategories(categories, now, [
      { id: "cat-dining", name: "Dining Out", group: "discretionary", nature: "discretionary", reservationMode: "envelope", sortOrder: 10 },
      { id: "cat-transfers", name: "Transfers", group: "administrative", nature: "administrative", reservationMode: "none", sortOrder: 20 }
    ]);

    expect(result.updatedIds).toEqual(["cat-dining"]);
    expect(result.categories.find((item) => item.id === "cat-dining")).toMatchObject({
      name: "Meals Out",
      reservationMode: "envelope"
    });
    expect(result.categories.find((item) => item.id === "cat-transfers")?.reservationMode).toBe("none");
  });

  it("adds missing starter IDs once and preserves same-name custom categories", () => {
    const categories = [category("custom-hobbies", "Hobbies", "discretionary", "discretionary", "envelope", 99)];
    const definitions = [
      { id: "cat-hobbies", name: "Hobbies", group: "discretionary", nature: "discretionary", reservationMode: "envelope", sortOrder: 10 },
      { id: "cat-gifts", name: "Gifts", group: "discretionary", nature: "discretionary", reservationMode: "envelope", sortOrder: 20 }
    ] satisfies Parameters<typeof reconcileStarterCategories>[2];

    const first = reconcileStarterCategories(categories, now, definitions);
    const second = reconcileStarterCategories(first.categories, now, definitions);

    expect(first.addedIds).toEqual(["cat-gifts"]);
    expect(first.categories.filter((item) => item.name === "Hobbies")).toHaveLength(1);
    expect(second.addedIds).toEqual([]);
  });

  it("validates contradictory category configurations", () => {
    expect(validateCategoryConfiguration({ group: "administrative", nature: "administrative", reservationMode: "envelope" }).valid).toBe(false);
    expect(validateCategoryConfiguration({ group: "discretionary", nature: "discretionary", reservationMode: "none" }).valid).toBe(false);
    expect(validateCategoryConfiguration({ group: "committed", nature: "essential", reservationMode: "envelope" }).warning).toContain("Committed");
    expect(validateCategoryConfiguration({ group: "protected", nature: "protected", reservationMode: "protected" }).valid).toBe(true);
  });

  it("reorders categories by swapping deterministic sort orders", () => {
    const categories = [
      category("cat-one", "One", "discretionary", "discretionary", "envelope", 10),
      category("cat-two", "Two", "discretionary", "discretionary", "envelope", 20)
    ];
    const moved = moveCategory(categories, "cat-two", "up", now);

    expect(moved.find((item) => item.id === "cat-two")?.sortOrder).toBe(10);
    expect(moved.find((item) => item.id === "cat-one")?.sortOrder).toBe(20);
  });
});

function category(
  id: string,
  name: string,
  group: Category["group"],
  nature: Category["nature"],
  reservationMode: Category["reservationMode"],
  sortOrder: number
): Category {
  return {
    id,
    name,
    group,
    nature,
    reservationMode,
    sortOrder,
    active: true,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    revision: 1
  };
}
