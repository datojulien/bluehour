import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "../../test/fixtures/demoData";
import { decryptBackup, encryptBackup } from "./encryptedBackup";

describe("encrypted backup", () => {
  it("round-trips a Bluehour snapshot with a passphrase", async () => {
    const snapshot = {
      ...createDemoSnapshot(),
      importRowAudits: [
        {
          id: "audit-backup",
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
          archivedAt: null,
          revision: 1,
          importBatchId: "batch-backup",
          rowIndex: 0,
          fileHash: "hash",
          occurredOn: "2026-07-12" as const,
          description: "Backup audit row",
          signedAmountMinor: -1_200,
          accountId: "acc-meranti-current",
          rowFingerprint: "fingerprint",
          outcome: "uncertain" as const,
          matchScore: 60,
          matchReasonsJson: JSON.stringify(["same amount"]),
          candidateTransactionIdsJson: JSON.stringify(["txn-candidate"]),
          candidateScoresJson: JSON.stringify([{ transactionId: "txn-candidate", score: 60, reasons: ["same amount"] }]),
          decisionSource: "none" as const
        }
      ]
    };
    const envelope = await encryptBackup(snapshot, "correct horse battery staple");
    const restored = await decryptBackup(envelope, "correct horse battery staple");

    expect(restored.accounts.length).toBe(snapshot.accounts.length);
    expect(restored.transactions.length).toBe(snapshot.transactions.length);
    expect(restored.importRowAudits).toHaveLength(1);
  });

  it("rejects short passphrases", async () => {
    await expect(encryptBackup(createDemoSnapshot(), "short")).rejects.toThrow(/at least 8/);
  });
});
