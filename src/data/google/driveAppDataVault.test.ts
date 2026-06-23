import { describe, expect, it, vi } from "vitest";
import { createDemoSnapshot } from "../../test/fixtures/demoData";
import {
  DRIVE_VAULT_MANIFEST_NAME,
  DRIVE_VAULT_SLOT_A_NAME,
  DRIVE_VAULT_SLOT_B_NAME,
  createDriveConnectionDescriptor,
  ensureDriveVaultFiles,
  pushSnapshotToDriveVault,
  readSnapshotFromDriveVault,
  resetDriveVault
} from "./driveAppDataVault";

describe("Drive app-data vault", () => {
  it("creates manifest and slot files in appDataFolder", async () => {
    const created: Array<{ name: string; parents: string[] }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://www.googleapis.com/drive/v3/files?") && init?.method === "GET") {
        const parsed = new URL(url);
        expect(parsed.searchParams.get("spaces")).toBe("appDataFolder");
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }

      if (url === "https://www.googleapis.com/drive/v3/files?fields=id,name" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { name: string; parents: string[] };
        created.push(body);
        return new Response(JSON.stringify({ id: `file-${created.length}`, name: body.name }), { status: 200 });
      }

      throw new Error(`Unexpected request ${init?.method ?? "GET"} ${url}`);
    });

    const files = await ensureDriveVaultFiles("token", fetcher as unknown as typeof fetch);

    expect(files).toEqual({
      manifestFileId: "file-1",
      slotAFileId: "file-2",
      slotBFileId: "file-3"
    });
    expect(created.map((file) => file.name)).toEqual([DRIVE_VAULT_MANIFEST_NAME, DRIVE_VAULT_SLOT_A_NAME, DRIVE_VAULT_SLOT_B_NAME]);
    expect(created.every((file) => file.parents.includes("appDataFolder"))).toBe(true);
  });

  it("writes the inactive slot, validates read-back, then commits the manifest last", async () => {
    const stored = new Map<string, unknown>([
      [
        "manifest-file",
        {
          kind: "bluehour-drive-vault-manifest",
          schemaVersion: 2,
          remoteRevision: 4,
          activeSlot: "A",
          files: {
            manifestFileId: "manifest-file",
            slotAFileId: "slot-a-file",
            slotBFileId: "slot-b-file"
          }
        }
      ]
    ]);
    const writes: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("alt=media")) {
        const fileId = /\/files\/([^?]+)/.exec(url)?.[1] ?? "";
        const value = stored.get(decodeURIComponent(fileId));
        return new Response(JSON.stringify(value ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      if (url.includes("/upload/drive/v3/files/") && init?.method === "PATCH") {
        const fileId = /\/files\/([^?]+)/.exec(url)?.[1] ?? "";
        writes.push(decodeURIComponent(fileId));
        stored.set(decodeURIComponent(fileId), JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ id: decodeURIComponent(fileId) }), { status: 200 });
      }

      throw new Error(`Unexpected request ${init?.method ?? "GET"} ${url}`);
    });

    const manifest = await pushSnapshotToDriveVault(
      {
        manifestFileId: "manifest-file",
        slotAFileId: "slot-a-file",
        slotBFileId: "slot-b-file"
      },
      createDemoSnapshot(),
      "token",
      fetcher as unknown as typeof fetch,
      5,
      4
    );

    expect(writes).toEqual(["slot-b-file", "manifest-file"]);
    expect(manifest.activeSlot).toBe("B");
    expect(manifest.remoteRevision).toBe(5);
    expect(stored.get("manifest-file")).toMatchObject({
      kind: "bluehour-drive-vault-manifest",
      activeSlot: "B",
      remoteRevision: 5
    });
  });

  it("returns unsupported newer schema without applying slot data", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          kind: "bluehour-drive-vault-manifest",
          schemaVersion: 999,
          remoteRevision: 7,
          activeSlot: "A",
          files: {
            manifestFileId: "manifest-file",
            slotAFileId: "slot-a-file",
            slotBFileId: "slot-b-file"
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const remote = await readSnapshotFromDriveVault(
      {
        manifestFileId: "manifest-file",
        slotAFileId: "slot-a-file",
        slotBFileId: "slot-b-file"
      },
      "token",
      fetcher as unknown as typeof fetch
    );

    expect(remote?.schemaVersion).toBe(999);
    expect(remote?.remoteRevision).toBe(7);
    expect(remote?.snapshot).toEqual({});
  });

  it("stores Drive file IDs and account metadata without OAuth tokens", () => {
    const descriptor = createDriveConnectionDescriptor(
      {
        manifestFileId: "manifest-file",
        slotAFileId: "slot-a-file",
        slotBFileId: "slot-b-file"
      },
      {
        profileId: "profile-1",
        googleSubject: "google-subject",
        googleEmail: "person@example.com",
        googleName: "Example Person",
        lastKnownRemoteRevision: 3,
        lastSuccessfulSyncAt: "2026-06-22T09:42:00.000Z"
      }
    );

    expect(descriptor).toMatchObject({
      provider: "drive_appdata",
      driveManifestFileId: "manifest-file",
      driveSlotAFileId: "slot-a-file",
      driveSlotBFileId: "slot-b-file",
      googleSubject: "google-subject",
      lastKnownRemoteRevision: 3
    });
    expect(JSON.stringify(descriptor)).not.toMatch(/access_token|refresh_token|Bearer|password/i);
  });

  it("resets the hidden Drive vault by deleting manifest and slot files", async () => {
    const deleted: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("alt=media")) {
        return new Response(
          JSON.stringify({
            kind: "bluehour-drive-vault-manifest",
            schemaVersion: 2,
            remoteRevision: 4,
            activeSlot: "A",
            files: {
              manifestFileId: "manifest-file",
              slotAFileId: "slot-a-file",
              slotBFileId: "slot-b-file"
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (init?.method === "DELETE") {
        deleted.push(decodeURIComponent(/\/files\/([^?]+)/.exec(url)?.[1] ?? ""));
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request ${init?.method ?? "GET"} ${url}`);
    });

    await resetDriveVault(
      {
        manifestFileId: "manifest-file",
        slotAFileId: "slot-a-file",
        slotBFileId: "slot-b-file"
      },
      "token",
      fetcher as unknown as typeof fetch,
      4
    );

    expect(deleted.sort()).toEqual(["manifest-file", "slot-a-file", "slot-b-file"]);
  });

  it("treats missing Drive vault files as already reset", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("alt=media")) {
        return new Response("{}", { status: 404 });
      }
      if (init?.method === "DELETE") {
        return new Response("{}", { status: 404 });
      }
      throw new Error(`Unexpected request ${init?.method ?? "GET"} ${url}`);
    });

    await expect(
      resetDriveVault(
        {
          manifestFileId: "manifest-file",
          slotAFileId: "slot-a-file",
          slotBFileId: "slot-b-file"
        },
        "token",
        fetcher as unknown as typeof fetch,
        0
      )
    ).resolves.toBeUndefined();
  });

  it("surfaces Drive permission failures during reset", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("alt=media")) {
        return new Response("{}", { status: 404 });
      }
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ error: { message: "insufficient permissions" } }), { status: 403 });
      }
      throw new Error(`Unexpected request ${init?.method ?? "GET"} ${url}`);
    });

    await expect(
      resetDriveVault(
        {
          manifestFileId: "manifest-file",
          slotAFileId: "slot-a-file",
          slotBFileId: "slot-b-file"
        },
        "token",
        fetcher as unknown as typeof fetch
      )
    ).rejects.toThrow(/insufficient permissions/);
  });

  it("blocks Drive vault reset when the remote revision changed", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          kind: "bluehour-drive-vault-manifest",
          schemaVersion: 2,
          remoteRevision: 8,
          activeSlot: "A",
          files: {
            manifestFileId: "manifest-file",
            slotAFileId: "slot-a-file",
            slotBFileId: "slot-b-file"
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(
      resetDriveVault(
        {
          manifestFileId: "manifest-file",
          slotAFileId: "slot-a-file",
          slotBFileId: "slot-b-file"
        },
        "token",
        fetcher as unknown as typeof fetch,
        7
      )
    ).rejects.toThrow(/remote_revision_changed/);
  });
});
