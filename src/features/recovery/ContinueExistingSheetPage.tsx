import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, Upload } from "lucide-react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import {
  DRIVE_VAULT_SCHEMA_VERSION,
  ensureDriveVaultFiles,
  pushSnapshotToDriveVault,
  readSnapshotFromDriveVault
} from "../../data/google/driveAppDataVault";
import {
  fetchGoogleAccountProfile,
  requestGoogleAccessToken,
  type GoogleAccountProfile
} from "../../data/google/googleAuth";
import { initializeLiveProfile, loadLiveSnapshot } from "../../data/local-db/localDb";
import { inspectDriveVaultProfile, prepareDriveVaultRestore, type DriveProfileInspection } from "../../data/recovery/driveProfile";
import {
  hasMeaningfulProfileData,
  nextManifestForCheckpoint,
  profileManifestSettingRecord,
  readProfileManifest
} from "../../domain/profileManifest";
import { formatDisplayDate } from "../../domain/dates";
import type { BluehourSnapshot } from "../../domain/types";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export function ContinueWithGooglePage() {
  const { loading, error, deviceIdentity, restoreRemoteProfile, returnToWelcome } = useBluehourData();
  const [account, setAccount] = useState<GoogleAccountProfile | null>(null);
  const [inspection, setInspection] = useState<DriveProfileInspection | null>(null);
  const [localHasData, setLocalHasData] = useState(false);
  const [localProfileId, setLocalProfileId] = useState<string | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadLiveSnapshot().then((snapshot) => {
      setLocalHasData(hasMeaningfulProfileData(snapshot));
      try {
        setLocalProfileId(readProfileManifest(snapshot.settings)?.profileId ?? null);
      } catch {
        setLocalProfileId(null);
      }
    });
  }, []);

  if (loading) {
    return <div className="loading-state full-page-state">Opening Google sign-in...</div>;
  }

  async function connectGoogle() {
    setBusy(true);
    setStatus(null);
    setInspection(null);
    try {
      if (!GOOGLE_CLIENT_ID) {
        throw new Error("Set VITE_GOOGLE_CLIENT_ID before connecting Google");
      }

      const token = await requestGoogleAccessToken(GOOGLE_CLIENT_ID);
      const profile = await fetchGoogleAccountProfile(token);
      const files = await ensureDriveVaultFiles(token);
      const remote = await readSnapshotFromDriveVault(files, token);
      const nextInspection = inspectDriveVaultProfile(files, profile, remote);
      setAccount(profile);
      setInspection(nextInspection);

      if (!nextInspection.meaningfulRemoteData && !localHasData) {
        await createVaultFromThisDevice(profile, files, nextInspection.remoteRevision, token);
        return;
      }

      if (!nextInspection.meaningfulRemoteData) {
        setStatus("Google connected. No Bluehour Drive vault exists yet; confirm below to create one from this device.");
        return;
      }

      setStatus("Google Drive vault found. Preview it before setting up this browser.");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function createVaultFromThisDevice(
    profile = account,
    files = inspection?.files,
    existingRevision = inspection?.remoteRevision ?? 0,
    existingToken?: string
  ) {
    setBusy(true);
    setStatus(null);
    try {
      if (!GOOGLE_CLIENT_ID) {
        throw new Error("Set VITE_GOOGLE_CLIENT_ID before connecting Google");
      }
      if (!profile || !files) {
        throw new Error("Sign in with Google before creating a Drive vault");
      }
      if (localHasData && !replaceConfirmed) {
        throw new Error("Confirm before creating the Google Drive vault from this device.");
      }

      await initializeLiveProfile();
      const token = existingToken ?? (await requestGoogleAccessToken(GOOGLE_CLIENT_ID));
      const localSnapshot = checkpointSnapshotAfterGoogle(await loadLiveSnapshot(), deviceIdentity?.deviceId);
      const nextRemoteRevision = existingRevision + 1;
      await pushSnapshotToDriveVault(files, localSnapshot, token, fetch, nextRemoteRevision, existingRevision);
      const remote = await readSnapshotFromDriveVault(files, token);
      const nextInspection = inspectDriveVaultProfile(files, profile, remote);
      const restore = prepareDriveVaultRestore({
        inspection: nextInspection,
        now: new Date().toISOString(),
        appVersion: __BLUEHOUR_VERSION__,
        deviceId: deviceIdentity?.deviceId
      });
      await restoreRemoteProfile(restore);
      setStatus("Google Drive vault created. Setup can continue on this device or another browser.");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Google Drive vault creation failed");
    } finally {
      setBusy(false);
    }
  }

  async function restoreDriveVault() {
    setBusy(true);
    setStatus(null);
    try {
      if (!inspection) {
        throw new Error("Sign in before restoring a Google Drive vault");
      }
      if (localHasData && !replaceConfirmed) {
        throw new Error("Confirm replacement before changing this device");
      }
      const restore = prepareDriveVaultRestore({
        inspection,
        now: new Date().toISOString(),
        appVersion: __BLUEHOUR_VERSION__,
        deviceId: deviceIdentity?.deviceId
      });
      await restoreRemoteProfile(restore);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Google Drive restore failed");
    } finally {
      setBusy(false);
    }
  }

  const remoteProfileId = inspection?.manifest?.profileId ?? null;
  const differentProfile = Boolean(localHasData && localProfileId && remoteProfileId && localProfileId !== remoteProfileId);
  const restoreDisabled = !inspection?.meaningfulRemoteData || inspection.consistencyErrors.length > 0 || busy || (localHasData && !replaceConfirmed);
  const createDisabled = !inspection || inspection.meaningfulRemoteData || busy || (localHasData && !replaceConfirmed);

  return (
    <main className="welcome-screen">
      <section className="welcome-panel recovery-wizard">
        <div className="welcome-copy">
          <p className="eyebrow">Google account</p>
          <h1>Continue with Google</h1>
          <p>
            Sign in once and Bluehour will use a hidden Google Drive app-data vault for this profile. IndexedDB remains the fast local cache for
            each browser.
          </p>
        </div>

        {error ? <div className="alert-band danger">{error}</div> : null}
        {status ? <div className="alert-band">{status}</div> : null}

        <ol className="recovery-steps">
          <li className={account ? "complete" : "active"}>
            <strong>1. Sign in to Google</strong>
            <small>Uses Google profile plus Drive app-data access. Tokens stay in memory only.</small>
            <button className="primary-action" type="button" onClick={() => void connectGoogle()} disabled={busy || !GOOGLE_CLIENT_ID}>
              <KeyRound size={16} aria-hidden="true" />
              Continue with Google
            </button>
          </li>
          <li className={inspection ? "active" : ""}>
            <strong>2. Google Drive vault</strong>
            {account ? (
              <small>
                Signed in as {account.email ?? account.name ?? account.sub}. Bluehour stores hidden app files in this Google account.
              </small>
            ) : (
              <small>No Google account has been connected yet.</small>
            )}
            {inspection ? <DriveVaultPreview inspection={inspection} /> : null}
          </li>
          <li className={inspection ? "active" : ""}>
            <strong>3. Confirm this browser</strong>
            {localHasData ? (
              <div className="alert-band danger">
                <strong>This browser already contains a Bluehour live profile.</strong>
                <p>Export an encrypted backup before replacing it. Bluehour will not merge unrelated profile IDs silently.</p>
                {differentProfile ? <p>Remote and local profile IDs differ, so automatic sync is blocked.</p> : null}
                <label className="checkbox-label">
                  <input type="checkbox" checked={replaceConfirmed} onChange={(event) => setReplaceConfirmed(event.target.checked)} />
                  {inspection?.meaningfulRemoteData ? "Replace this browser with the Google Drive vault profile" : "Create the Google Drive vault from this browser"}
                </label>
              </div>
            ) : (
              <small>This browser has no meaningful live records. Google can set it up automatically.</small>
            )}
          </li>
          <li className={inspection ? "active" : ""}>
            <strong>4. Open Bluehour</strong>
            {inspection?.meaningfulRemoteData ? (
              <button className="primary-action" type="button" onClick={() => void restoreDriveVault()} disabled={restoreDisabled}>
                <ShieldCheck size={16} aria-hidden="true" />
                {localHasData ? "Replace local profile with Google vault" : "Set up this browser from Google vault"}
              </button>
            ) : (
              <button className="primary-action" type="button" onClick={() => void createVaultFromThisDevice()} disabled={createDisabled}>
                <Upload size={16} aria-hidden="true" />
                Create Google Drive vault from this browser
              </button>
            )}
          </li>
        </ol>

        <div className="form-actions">
          <button className="secondary-action" type="button" onClick={() => void returnToWelcome()} disabled={busy}>
            Cancel
          </button>
        </div>
      </section>
    </main>
  );
}

function DriveVaultPreview({ inspection }: { inspection: DriveProfileInspection }) {
  const manifest = inspection.manifest;
  const lifecycle = manifest?.lifecycle ?? "setup";
  const step = manifest?.onboardingStep;
  return (
    <div className="remote-preview" aria-label="Google Drive vault preview">
      <div className="data-row">
        <span>Vault</span>
        <strong>{inspection.vaultExists ? "Found" : "Will be created"}</strong>
      </div>
      <div className="data-row">
        <span>Profile</span>
        <strong>{manifest?.profileName ?? "New Bluehour profile"}</strong>
      </div>
      <div className="data-row">
        <span>Status</span>
        <strong>
          {lifecycle === "setup" ? `Onboarding${step ? ` - ${step}` : ""}` : lifecycle === "ready_for_salary" ? "Ready for salary" : lifecycle}
        </strong>
      </div>
      <div className="data-row">
        <span>Schema</span>
        <strong>
          {inspection.schemaVersion} / supported {DRIVE_VAULT_SCHEMA_VERSION}
        </strong>
      </div>
      <div className="data-row">
        <span>Last saved</span>
        <strong>{inspection.exportedAt ? formatDateTime(inspection.exportedAt) : "Not recorded"}</strong>
      </div>
      <div className="data-row">
        <span>Remote revision</span>
        <strong>{inspection.remoteRevision}</strong>
      </div>
      <div className="data-row">
        <span>Counts</span>
        <strong>
          Accounts {inspection.counts.accounts} · Transactions {inspection.counts.transactions} · Budget cycles {inspection.counts.budgetCycles}
        </strong>
      </div>
      {inspection.warnings.map((warning) => (
        <p className="form-note danger-text" key={warning}>
          {warning}
        </p>
      ))}
      {inspection.consistencyErrors.map((warning) => (
        <p className="form-error" key={warning}>
          {warning}
        </p>
      ))}
    </div>
  );
}

function checkpointSnapshotAfterGoogle(snapshot: BluehourSnapshot, deviceId?: string): BluehourSnapshot {
  const now = new Date().toISOString();
  const manifest = readProfileManifest(snapshot.settings);
  if (!manifest || manifest.lifecycle !== "setup" || manifest.onboardingStep !== "google") {
    return snapshot;
  }

  const nextManifest = nextManifestForCheckpoint({
    current: manifest,
    now,
    appVersion: __BLUEHOUR_VERSION__,
    deviceId,
    lifecycle: "setup",
    onboardingStep: "preferences"
  });
  const manifestSetting = profileManifestSettingRecord(snapshot.settings, nextManifest);
  return {
    ...snapshot,
    settings: [...snapshot.settings.filter((setting) => setting.id !== manifestSetting.id), manifestSetting]
  };
}

function formatDateTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return `${formatDisplayDate(date.toISOString().slice(0, 10) as `${number}-${number}-${number}`)} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}
