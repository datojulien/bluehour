export const GOOGLE_DRIVE_VAULT_SCOPES = "openid email profile https://www.googleapis.com/auth/drive.appdata";
export const GOOGLE_SHEETS_SCOPES = "https://www.googleapis.com/auth/drive.file";

const GOOGLE_SESSION_MAX_MS = 60 * 60 * 1000;
const GOOGLE_SESSION_SAFETY_MARGIN_MS = 30 * 1000;

interface GoogleAccessTokenSession {
  accessToken: string;
  scopes: string;
  issuedAt: number;
  expiresAt: number;
}

const inMemorySessions = new Map<string, GoogleAccessTokenSession>();

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
}

interface GoogleTokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
          }) => GoogleTokenClient;
        };
      };
    };
  }
}

export function getInMemoryGoogleAccessToken(scopes = GOOGLE_DRIVE_VAULT_SCOPES): string | null {
  return getInMemoryGoogleSession(scopes)?.accessToken ?? null;
}

export function getInMemoryGoogleSession(scopes = GOOGLE_DRIVE_VAULT_SCOPES): GoogleAccessTokenSession | null {
  const key = scopeKey(scopes);
  const session = inMemorySessions.get(key);
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    inMemorySessions.delete(key);
    return null;
  }

  return session;
}

export function clearInMemoryGoogleAccessToken(scopes?: string): void {
  if (scopes) {
    inMemorySessions.delete(scopeKey(scopes));
    return;
  }

  inMemorySessions.clear();
}

export interface GoogleAccountProfile {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

export async function requestGoogleAccessToken(
  clientId: string,
  {
    scopes = GOOGLE_DRIVE_VAULT_SCOPES,
    prompt,
    forceRefresh = false
  }: {
    scopes?: string;
    prompt?: "consent" | "select_account" | "";
    forceRefresh?: boolean;
  } = {}
): Promise<string> {
  if (!forceRefresh && prompt === undefined) {
    const existing = getInMemoryGoogleAccessToken(scopes);
    if (existing) {
      return existing;
    }
  }

  await loadGoogleIdentityScript();
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts.oauth2) {
      reject(new Error("Google Identity Services did not load"));
      return;
    }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: scopes,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error ?? "Google did not return an access token"));
          return;
        }

        rememberAccessToken(scopes, response);
        resolve(response.access_token);
      }
    });
    tokenClient.requestAccessToken(prompt !== undefined ? { prompt } : undefined);
  });
}

export async function fetchGoogleAccountProfile(accessToken: string, fetcher: typeof fetch = fetch): Promise<GoogleAccountProfile> {
  const response = await fetcher("https://openidconnect.googleapis.com/v1/userinfo", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Google account profile read failed");
  }

  const body = (await response.json()) as Partial<GoogleAccountProfile>;
  if (!body.sub) {
    throw new Error("Google did not return an account subject");
  }

  return {
    sub: body.sub,
    email: body.email,
    name: body.name,
    picture: body.picture
  };
}

function rememberAccessToken(scopes: string, response: GoogleTokenResponse): void {
  if (!response.access_token) {
    return;
  }

  const issuedAt = Date.now();
  const expiresInSeconds = Number(response.expires_in ?? 3600);
  const boundedExpiresInMs = Math.min(
    Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds * 1000 : GOOGLE_SESSION_MAX_MS,
    GOOGLE_SESSION_MAX_MS
  );
  const expiresAt = issuedAt + Math.max(0, boundedExpiresInMs - GOOGLE_SESSION_SAFETY_MARGIN_MS);
  inMemorySessions.set(scopeKey(scopes), {
    accessToken: response.access_token,
    scopes,
    issuedAt,
    expiresAt
  });
}

function scopeKey(scopes: string): string {
  return scopes
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
    .sort()
    .join(" ");
}

function loadGoogleIdentityScript(): Promise<void> {
  if (window.google?.accounts.oauth2) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google Identity Services failed to load")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Identity Services failed to load"));
    document.head.append(script);
  });
}
