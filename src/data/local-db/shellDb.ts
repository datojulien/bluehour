import { openDB, type DBSchema } from "idb";
import type { UtcIsoTimestamp } from "../../domain/types";
import { legacyDatabaseExists, type ProfileId } from "./localDb";

export type ApplicationState =
  | "welcome"
  | "demo"
  | "setup"
  | "ready_for_salary"
  | "live"
  | "needs_google_reconnection"
  | "sync_conflict"
  | "read_only_recovery";

export type OnboardingStep =
  | "welcome"
  | "google"
  | "preferences"
  | "accounts"
  | "income"
  | "obligations"
  | "budget"
  | "wait_salary"
  | "start_cycle";

export interface ShellState {
  key: "state";
  applicationState: ApplicationState;
  activeProfile?: ProfileId;
  onboardingStep: OnboardingStep;
  legacyDatabaseDetected: boolean;
  updatedAt: UtcIsoTimestamp;
}

interface ShellDB extends DBSchema {
  shellState: { key: string; value: ShellState };
}

const SHELL_DB_NAME = "bluehour-shell";
const SHELL_DB_VERSION = 1;

async function openShellDb() {
  return openDB<ShellDB>(SHELL_DB_NAME, SHELL_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("shellState")) {
        db.createObjectStore("shellState", { keyPath: "key" });
      }
    }
  });
}

export async function loadShellState(): Promise<ShellState> {
  const db = await openShellDb();
  const current = await db.get("shellState", "state");
  const legacyDatabaseDetected = await legacyDatabaseExists();

  if (current) {
    if (current.legacyDatabaseDetected === legacyDatabaseDetected) {
      return current;
    }

    const updated = { ...current, legacyDatabaseDetected, updatedAt: new Date().toISOString() };
    await db.put("shellState", updated);
    return updated;
  }

  const initial: ShellState = {
    key: "state",
    applicationState: "welcome",
    onboardingStep: "welcome",
    legacyDatabaseDetected,
    updatedAt: new Date().toISOString()
  };
  await db.put("shellState", initial);
  return initial;
}

export async function saveShellState(patch: Partial<Omit<ShellState, "key" | "updatedAt">>): Promise<ShellState> {
  const current = await loadShellState();
  const next: ShellState = {
    ...current,
    ...patch,
    key: "state",
    updatedAt: new Date().toISOString()
  };
  const db = await openShellDb();
  await db.put("shellState", next);
  return next;
}
