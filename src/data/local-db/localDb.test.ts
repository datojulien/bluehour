import { describe, expect, it } from "vitest";
import { loadDemoSnapshot, seedDemoIfNeeded } from "./localDb";

describe("local IndexedDB repository", () => {
  it("seeds fictional demo records idempotently", async () => {
    await seedDemoIfNeeded();
    await seedDemoIfNeeded();

    const snapshot = await loadDemoSnapshot();
    expect(snapshot.accounts.length).toBe(5);
    expect(snapshot.transactions.length).toBe(13);
    expect(snapshot.accounts.every((account) => account.currency === "MYR")).toBe(true);
  });
});
