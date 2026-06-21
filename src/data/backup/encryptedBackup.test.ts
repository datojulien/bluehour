import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "../../test/fixtures/demoData";
import { decryptBackup, encryptBackup } from "./encryptedBackup";

describe("encrypted backup", () => {
  it("round-trips a Bluehour snapshot with a passphrase", async () => {
    const snapshot = createDemoSnapshot();
    const envelope = await encryptBackup(snapshot, "correct horse battery staple");
    const restored = await decryptBackup(envelope, "correct horse battery staple");

    expect(restored.accounts.length).toBe(snapshot.accounts.length);
    expect(restored.transactions.length).toBe(snapshot.transactions.length);
  });

  it("rejects short passphrases", async () => {
    await expect(encryptBackup(createDemoSnapshot(), "short")).rejects.toThrow(/at least 8/);
  });
});
