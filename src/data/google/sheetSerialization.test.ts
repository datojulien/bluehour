import { describe, expect, it, vi } from "vitest";
import { createDemoSnapshot } from "../../test/fixtures/demoData";
import { deserializeSnapshotFromSheets, pushSnapshotToGoogleSheet, serializeSnapshotToSheets } from "./sheetSerialization";

describe("sheet serialization", () => {
  it("serializes domain tables into readable raw rows", () => {
    const payload = serializeSnapshotToSheets(createDemoSnapshot());

    expect(payload.Meta[0]).toEqual(["key", "value"]);
    expect(payload.Meta[2]).toEqual(["remoteRevision", 1]);
    expect(payload.Meta[1]).toEqual(["schemaVersion", 2]);
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

  it("pushes into an inactive slot and commits Meta last", async () => {
    const sheet = new Map<string, unknown[][]>([
      [
        "Meta!A1:ZZZ",
        [
          ["key", "value"],
          ["schemaVersion", 2],
          ["remoteRevision", 3],
          ["activeSlot", "A"]
        ]
      ],
      ["A_Accounts!A1:ZZZ", [["id", "name"], ["old", "Old active account"]]]
    ]);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const pathname = decodeURIComponent(url.pathname);
      const body = init?.body ? JSON.parse(String(init.body)) : {};

      if (url.pathname.endsWith("values:batchGet")) {
        const valueRanges = url.searchParams.getAll("ranges").map((range) => ({
          range,
          values: sheet.get(range) ?? []
        }));
        return new Response(JSON.stringify({ valueRanges }), { status: 200 });
      }

      const range = pathname.match(/\/values\/(.+?)(?::clear)?$/)?.[1];
      if (!range) {
        return new Response("{}", { status: 200 });
      }

      if (url.pathname.endsWith(":clear")) {
        sheet.set(range, []);
      } else {
        sheet.set(range.replace("!A1", "!A1:ZZZ"), body.values);
      }

      return new Response("{}", { status: 200 });
    });

    await pushSnapshotToGoogleSheet("sheet-1", createDemoSnapshot(), "token", fetcher as unknown as typeof fetch);

    expect(sheet.get("A_Accounts!A1:ZZZ")).toEqual([["id", "name"], ["old", "Old active account"]]);
    expect(sheet.get("B_Accounts!A1:ZZZ")?.[0]).toContain("name");
    expect(sheet.get("Meta!A1:ZZZ")).toContainEqual(["activeSlot", "B"]);
    expect(fetcher.mock.calls.at(-1)?.[0].toString()).toContain("Meta!A1");
  });

  it("leaves the old active slot untouched when inactive-slot verification fails", async () => {
    const sheet = new Map<string, unknown[][]>([
      [
        "Meta!A1:ZZZ",
        [
          ["key", "value"],
          ["schemaVersion", 2],
          ["remoteRevision", 3],
          ["activeSlot", "A"]
        ]
      ],
      ["A_Accounts!A1:ZZZ", [["id", "name"], ["old", "Old active account"]]]
    ]);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const pathname = decodeURIComponent(url.pathname);
      const body = init?.body ? JSON.parse(String(init.body)) : {};

      if (url.pathname.endsWith("values:batchGet")) {
        const valueRanges = url.searchParams.getAll("ranges").map((range) => ({
          range,
          values: range.startsWith("B_") ? [] : sheet.get(range) ?? []
        }));
        return new Response(JSON.stringify({ valueRanges }), { status: 200 });
      }

      const range = pathname.match(/\/values\/(.+?)(?::clear)?$/)?.[1];
      if (range && !url.pathname.endsWith(":clear")) {
        sheet.set(range.replace("!A1", "!A1:ZZZ"), body.values);
      }

      return new Response("{}", { status: 200 });
    });

    await expect(pushSnapshotToGoogleSheet("sheet-1", createDemoSnapshot(), "token", fetcher as unknown as typeof fetch)).rejects.toThrow(
      /verification failed/
    );

    expect(sheet.get("A_Accounts!A1:ZZZ")).toEqual([["id", "name"], ["old", "Old active account"]]);
    expect(sheet.get("Meta!A1:ZZZ")).toContainEqual(["activeSlot", "A"]);
  });
});
