import { describe, expect, it, vi } from "vitest";
import { createDemoSnapshot } from "../../test/fixtures/demoData";
import { deserializeSnapshotFromSheets, pushSnapshotToGoogleSheet, serializeSnapshotToSheets } from "./sheetSerialization";

describe("sheet serialization", () => {
  it("serializes domain tables into readable raw rows", () => {
    const payload = serializeSnapshotToSheets(createDemoSnapshot());

    expect(payload.Meta[0]).toEqual(["key", "value"]);
    expect(payload.Meta[2]).toEqual(["remoteRevision", 1]);
    expect(payload.Accounts[0]).toContain("name");
    expect(payload.Transactions.length).toBeGreaterThan(1);
  });

  it("deserializes sheet rows back into domain-shaped records", () => {
    const payload = serializeSnapshotToSheets(createDemoSnapshot(), 7);
    const remote = deserializeSnapshotFromSheets(payload);

    expect(remote.remoteRevision).toBe(7);
    expect(remote.snapshot.accounts?.[0].currency).toBe("MYR");
    expect(remote.snapshot.accounts?.[0].reconcileWeekly).toBeTypeOf("boolean");
    expect(remote.snapshot.transactions?.[0].revision).toBeTypeOf("number");
  });

  it("pushes every serialized tab with raw value writes", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    await pushSnapshotToGoogleSheet("sheet-1", createDemoSnapshot(), "token", fetcher as unknown as typeof fetch);

    expect(fetcher.mock.calls.length).toBe(Object.keys(serializeSnapshotToSheets(createDemoSnapshot())).length * 2);
  });
});
