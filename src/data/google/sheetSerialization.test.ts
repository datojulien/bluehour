import { describe, expect, it, vi } from "vitest";
import { createDemoSnapshot } from "../../test/fixtures/demoData";
import {
  deserializeSnapshotFromSheets,
  pushSnapshotToGoogleSheet,
  readSnapshotFromGoogleSheet,
  RemoteRevisionChangedError,
  serializeSnapshotToSheets
} from "./sheetSerialization";

describe("sheet serialization", () => {
  it("serializes domain tables into readable raw rows", () => {
    const payload = serializeSnapshotToSheets(createDemoSnapshot());

    expect(payload.Meta[0]).toEqual(["key", "value"]);
    expect(payload.Meta[2]).toEqual(["remoteRevision", 1]);
    expect(payload.Meta[1]).toEqual(["schemaVersion", 3]);
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

  it("blocks stale-device pushes when the remote revision changed", async () => {
    const sheet = new Map<string, unknown[][]>([
      [
        "Meta!A1:ZZZ",
        [
          ["key", "value"],
          ["schemaVersion", 3],
          ["remoteRevision", 11],
          ["activeSlot", "A"]
        ]
      ],
      ["A_Accounts!A1:ZZZ", [["id", "name"], ["old", "Old active account"]]]
    ]);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("values:batchGet")) {
        const valueRanges = url.searchParams.getAll("ranges").map((range) => ({
          range,
          values: sheet.get(range) ?? []
        }));
        return new Response(JSON.stringify({ valueRanges }), { status: 200 });
      }

      throw new Error(`Unexpected write ${String(init?.method)}`);
    });

    await expect(pushSnapshotToGoogleSheet("sheet-1", createDemoSnapshot(), "token", fetcher as unknown as typeof fetch, 12, 10)).rejects.toBeInstanceOf(
      RemoteRevisionChangedError
    );
    expect(sheet.get("A_Accounts!A1:ZZZ")).toEqual([["id", "name"], ["old", "Old active account"]]);
  });

  it("rejects staged Google writes when read-back records differ with the same row count", async () => {
    const sheet = new Map<string, unknown[][]>([
      [
        "Meta!A1:ZZZ",
        [
          ["key", "value"],
          ["schemaVersion", 2],
          ["remoteRevision", 3],
          ["activeSlot", "A"]
        ]
      ]
    ]);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const pathname = decodeURIComponent(url.pathname);
      const body = init?.body ? JSON.parse(String(init.body)) : {};

      if (url.pathname.endsWith("values:batchGet")) {
        const valueRanges = url.searchParams.getAll("ranges").map((range) => {
          const values = sheet.get(range) ?? [];
          if (range === "B_Accounts!A1:ZZZ" && values.length > 1) {
            const nameIndex = values[0].indexOf("name");
            const corrupted = values.map((row) => [...row]);
            corrupted[1][nameIndex] = "Corrupted account name";
            return { range, values: corrupted };
          }

          return { range, values };
        });
        return new Response(JSON.stringify({ valueRanges }), { status: 200 });
      }

      const range = pathname.match(/\/values\/(.+?)(?::clear)?$/)?.[1];
      if (range && !url.pathname.endsWith(":clear")) {
        sheet.set(range.replace("!A1", "!A1:ZZZ"), body.values);
      }

      return new Response("{}", { status: 200 });
    });

    await expect(pushSnapshotToGoogleSheet("sheet-1", createDemoSnapshot(), "token", fetcher as unknown as typeof fetch)).rejects.toThrow(
      /verification failed for Accounts/
    );
  });

  it("validates remote Sheet records against runtime schemas", () => {
    const payload = serializeSnapshotToSheets(createDemoSnapshot());
    const currencyIndex = payload.Accounts[0].indexOf("currency");
    payload.Accounts[1][currencyIndex] = "USD";

    expect(() => deserializeSnapshotFromSheets(payload)).toThrow(/failed schema validation/);
  });

  it("round-trips import audit rows through mocked Sheet serialization", () => {
    const snapshot = {
      ...createDemoSnapshot(),
      importRowAudits: [
        {
          id: "audit-1",
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
          archivedAt: null,
          revision: 1,
          importBatchId: "batch-1",
          rowIndex: 0,
          fileHash: "hash",
          occurredOn: "2026-07-12" as const,
          description: "=Formula-looking text",
          signedAmountMinor: -1_200,
          accountId: "acc-meranti-current",
          sourceReference: "ref-1",
          rowFingerprint: "fingerprint-1",
          outcome: "strong_linked" as const,
          linkedTransactionId: "txn-existing",
          matchScore: 95,
          matchReasonsJson: JSON.stringify(["same amount"]),
          candidateTransactionIdsJson: JSON.stringify(["txn-existing"]),
          candidateScoresJson: JSON.stringify([{ transactionId: "txn-existing", score: 95, reasons: ["same amount"] }]),
          decisionSource: "automatic" as const,
          decidedAt: "2026-07-12T00:00:00.000Z"
        }
      ]
    };

    const remote = deserializeSnapshotFromSheets(serializeSnapshotToSheets(snapshot));

    expect(remote.snapshot.importRowAudits?.[0]).toMatchObject({
      description: "=Formula-looking text",
      outcome: "strong_linked",
      linkedTransactionId: "txn-existing"
    });
  });

  it("reads v2 sheets without an import audit tab as migration sources", () => {
    const payload = serializeSnapshotToSheets(createDemoSnapshot(), 4);
    payload.Meta = [
      ["key", "value"],
      ["schemaVersion", 2],
      ["remoteRevision", 4],
      ["activeSlot", "A"]
    ];
    delete payload.ImportRowAudits;

    const remote = deserializeSnapshotFromSheets(payload);

    expect(remote.schemaVersion).toBe(2);
    expect(remote.snapshot.importRowAudits).toEqual([]);
  });

  it("reads a legacy single-slot Sheet as a migration source", async () => {
    const legacyPayload = serializeSnapshotToSheets(createDemoSnapshot(), 4);
    legacyPayload.Meta = [
      ["key", "value"],
      ["schemaVersion", 1],
      ["remoteRevision", 4]
    ];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const ranges = url.searchParams.getAll("ranges");
      return new Response(
        JSON.stringify({
          valueRanges: ranges.map((range) => ({
            range,
            values: legacyPayload[range.split("!")[0]] ?? []
          }))
        }),
        { status: 200 }
      );
    });

    const remote = await readSnapshotFromGoogleSheet("legacy-sheet", "token", fetcher as unknown as typeof fetch);

    expect(remote.schemaVersion).toBe(1);
    expect(remote.remoteRevision).toBe(4);
    expect(remote.activeSlot).toBeUndefined();
    expect(remote.snapshot.accounts?.length).toBeGreaterThan(0);
  });
});
