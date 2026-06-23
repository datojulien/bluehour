import { describe, expect, it } from "vitest";
import { createDemoSnapshot, demoAsOfDate } from "../../test/fixtures/demoData";
import type { ReviewSession } from "../types";
import { createExtraIncomeAllocation } from "../income/extraIncomeAllocation";
import { dailyReviewTasks, parseDailyReviewItems, upsertDailyReviewSession } from "./dailyReview";

describe("daily review", () => {
  it("creates deterministic tasks for savings review, imports, sync, and deferred extra income", () => {
    const snapshot = createDemoSnapshot();
    snapshot.importRowAudits = [
      {
        id: "audit-uncertain",
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
        archivedAt: null,
        revision: 1,
        importBatchId: "batch",
        rowIndex: 0,
        fileHash: "hash",
        occurredOn: demoAsOfDate,
        description: "Imported row",
        signedAmountMinor: -1_000,
        accountId: "acc-meranti-current",
        rowFingerprint: "fingerprint",
        outcome: "uncertain",
        matchReasonsJson: "[]",
        candidateTransactionIdsJson: "[]",
        candidateScoresJson: "[]",
        decisionSource: "none"
      }
    ];
    snapshot.extraIncomeAllocations = [
      createExtraIncomeAllocation({
        incomeTransactionId: "txn-extra",
        incomeAmountMinor: 10_000,
        availableMinor: 10_000,
        protectedMinor: 0,
        status: "deferred"
      })
    ];
    snapshot.outboxOperations = [{ id: "outbox-1", tableName: "transactions", recordId: "txn", operation: "put", payloadJson: "{}", createdAt: "2026-07-12T00:00:00.000Z", attempts: 0 }];

    expect(dailyReviewTasks(snapshot, demoAsOfDate).map((task) => task.id)).toEqual([
      "deferred-extra-income",
      "save-the-difference",
      "savings-coach-insights",
      "sync-pending",
      "uncertain-imports"
    ]);
  });

  it("preserves completed items, appends new tasks, and removes resolved tasks", () => {
    const existing: ReviewSession = {
      id: "review-daily",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
      archivedAt: null,
      revision: 1,
      type: "daily",
      periodKey: demoAsOfDate,
      status: "open",
      itemsJson: JSON.stringify([
        { id: "uncategorised-transactions", label: "Categorise", complete: true },
        { id: "resolved-task", label: "Resolved", complete: false }
      ])
    };

    const next = upsertDailyReviewSession(
      existing,
      [
        { id: "uncategorised-transactions", label: "Categorise", complete: false },
        { id: "sync-pending", label: "Sync", complete: false }
      ],
      demoAsOfDate
    );

    expect(parseDailyReviewItems(next)).toEqual([
      { id: "uncategorised-transactions", label: "Categorise", complete: true },
      { id: "sync-pending", label: "Sync", complete: false }
    ]);
  });
});
