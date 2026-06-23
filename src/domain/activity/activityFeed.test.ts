import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "../../test/fixtures/demoData";
import { buildActivityFeed } from "./activityFeed";

describe("activity feed", () => {
  it("derives transaction, budget-transfer, reconciliation, subscription-price, import, and cycle events from records", () => {
    const snapshot = createDemoSnapshot();
    snapshot.importBatches = [
      {
        id: "batch-demo",
        createdAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:00:00.000Z",
        archivedAt: null,
        revision: 1,
        importProfileId: "profile",
        fileName: "statement.csv",
        fileHash: "hash",
        importedAt: "2026-07-12T10:00:00.000Z",
        rowCount: 2,
        newCount: 1,
        matchedCount: 0,
        reviewCount: 1
      }
    ];
    snapshot.subscriptions = snapshot.subscriptions.map((subscription) => ({
      ...subscription,
      priceHistoryJson: JSON.stringify([
        {
          changedAt: "2026-07-12T11:00:00.000Z",
          effectiveDate: "2026-07-12",
          previousAmountMinor: 3_900,
          nextAmountMinor: 4_500
        }
      ])
    }));

    const feed = buildActivityFeed(snapshot, 20);
    const types = new Set(feed.map((item) => item.type));

    expect(types).toContain("transaction");
    expect(types).toContain("budget_transfer");
    expect(types).toContain("reconciliation");
    expect(types).toContain("subscription_price");
    expect(types).toContain("csv_import");
    expect(types).toContain("cycle_open");
  });

  it("sorts deterministically and excludes archived activity where appropriate", () => {
    const snapshot = createDemoSnapshot();
    snapshot.transactions = snapshot.transactions.map((transaction) =>
      transaction.id === "txn-dining" ? { ...transaction, archivedAt: "2026-07-12T12:00:00.000Z" } : transaction
    );

    const feed = buildActivityFeed(snapshot, 20);
    const order = feed.map((item) => item.occurredAt);

    expect(feed.some((item) => item.id === "transaction:txn-dining")).toBe(false);
    expect(order).toEqual([...order].sort((left, right) => right.localeCompare(left)));
  });
});
