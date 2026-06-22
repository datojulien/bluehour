export const GOOGLE_DRIVE_VAULT_SCOPES = "openid email profile https://www.googleapis.com/auth/drive.appdata";
export const GOOGLE_SHEETS_SCOPES = "https://www.googleapis.com/auth/drive.file";

let inMemoryAccessToken: string | null = null;

interface GoogleTokenResponse {
  access_token?: string;
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

export function getInMemoryGoogleAccessToken(): string | null {
  return inMemoryAccessToken;
}

export function clearInMemoryGoogleAccessToken(): void {
  inMemoryAccessToken = null;
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
    prompt
  }: {
    scopes?: string;
    prompt?: "consent" | "select_account" | "";
  } = {}
): Promise<string> {
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

        inMemoryAccessToken = response.access_token;
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
