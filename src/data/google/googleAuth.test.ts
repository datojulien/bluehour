import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_DRIVE_VAULT_SCOPES,
  clearInMemoryGoogleAccessToken,
  getInMemoryGoogleSession,
  fetchGoogleAccountProfile,
  getInMemoryGoogleAccessToken,
  requestGoogleAccessToken
} from "./googleAuth";

describe("Google auth", () => {
  afterEach(() => {
    clearInMemoryGoogleAccessToken();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("requests Drive vault scopes without forcing consent by default", async () => {
    const requestAccessToken = vi.fn((options?: { prompt?: string }) => {
      expect(options).toBeUndefined();
      tokenConfig.callback({ access_token: "memory-token" });
    });
    let tokenConfig: { scope: string; callback: (response: { access_token?: string; error?: string }) => void };
    vi.stubGlobal("google", {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn((config) => {
            tokenConfig = config;
            return { requestAccessToken };
          })
        }
      }
    });

    const token = await requestGoogleAccessToken("client-id");

    expect(token).toBe("memory-token");
    expect(tokenConfig!.scope).toBe(GOOGLE_DRIVE_VAULT_SCOPES);
    expect(getInMemoryGoogleAccessToken()).toBe("memory-token");
    expect(requestAccessToken).toHaveBeenCalledWith(undefined);
  });

  it("reuses a valid in-memory Drive token during the one-hour session", async () => {
    const requestAccessToken = vi.fn(() => {
      tokenConfig.callback({ access_token: "memory-token", expires_in: 3600 });
    });
    let tokenConfig: { callback: (response: { access_token?: string; expires_in?: number }) => void };
    vi.stubGlobal("google", {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn((config) => {
            tokenConfig = config;
            return { requestAccessToken };
          })
        }
      }
    });

    await expect(requestGoogleAccessToken("client-id")).resolves.toBe("memory-token");
    await expect(requestGoogleAccessToken("client-id")).resolves.toBe("memory-token");

    expect(requestAccessToken).toHaveBeenCalledTimes(1);
    expect(getInMemoryGoogleSession()?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("expires the in-memory token after the bounded session window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T00:00:00.000Z"));
    const requestAccessToken = vi.fn(() => {
      tokenConfig.callback({ access_token: `memory-token-${requestAccessToken.mock.calls.length}`, expires_in: 3600 });
    });
    let tokenConfig: { callback: (response: { access_token?: string; expires_in?: number }) => void };
    vi.stubGlobal("google", {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn((config) => {
            tokenConfig = config;
            return { requestAccessToken };
          })
        }
      }
    });

    await expect(requestGoogleAccessToken("client-id")).resolves.toBe("memory-token-1");
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(getInMemoryGoogleAccessToken()).toBeNull();
    await expect(requestGoogleAccessToken("client-id")).resolves.toBe("memory-token-2");
    expect(requestAccessToken).toHaveBeenCalledTimes(2);
  });

  it("allows explicit consent only when a caller asks for it", async () => {
    const requestAccessToken = vi.fn((options?: { prompt?: string }) => {
      expect(options).toEqual({ prompt: "consent" });
      tokenConfig.callback({ access_token: "memory-token" });
    });
    let tokenConfig: { callback: (response: { access_token?: string; error?: string }) => void };
    vi.stubGlobal("google", {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn((config) => {
            tokenConfig = config;
            return { requestAccessToken };
          })
        }
      }
    });

    await expect(requestGoogleAccessToken("client-id", { prompt: "consent" })).resolves.toBe("memory-token");
  });

  it("reads non-secret Google account metadata from userinfo", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            sub: "google-subject",
            email: "person@example.com",
            name: "Example Person",
            picture: "https://example.test/avatar.png"
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );

    const profile = await fetchGoogleAccountProfile("access-token", fetcher as unknown as typeof fetch);

    expect(profile).toEqual({
      sub: "google-subject",
      email: "person@example.com",
      name: "Example Person",
      picture: "https://example.test/avatar.png"
    });
    expect(JSON.stringify(profile)).not.toMatch(/access-token|refresh_token/i);
  });
});
