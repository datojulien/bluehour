import { useEffect, useState } from "react";
import { KeyRound, Link, Search, ShieldCheck } from "lucide-react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { clearInMemoryGoogleAccessToken, requestGoogleAccessToken } from "../../data/google/googleAuth";
import { ensureBluehourSheetSchema, listBluehourSpreadsheets, type GoogleDriveFileSummary } from "../../data/google/googleSheetsAdapter";
import { pushSnapshotToGoogleSheet } from "../../data/google/sheetSerialization";
import { loadLiveSnapshot } from "../../data/local-db/localDb";
import {
  inspectRemoteBluehourSheet,
  prepareRemoteRestore,
  type RemoteProfileInspection
} from "../../data/recovery/remoteProfile";
import {
  hasMeaningfulProfileData,
  readProfileManifest,
  type ManifestOnboardingStep,
  type RemoteProfileLifecycle
} from "../../domain/profileManifest";
import { formatDisplayDate } from "../../domain/dates";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

const legacyChoices: Array<{ label: string; lifecycle: RemoteProfileLifecycle; onboardingStep?: ManifestOnboardingStep }> = [
  { label: "Resume setup from Accounts", lifecycle: "setup", onboardingStep: "accounts" },
  { label: "Resume setup from Income", lifecycle: "setup", onboardingStep: "income" },
  { label: "Resume setup from Obligations", lifecycle: "setup", onboardingStep: "obligations" },
  { label: "Resume setup from Budget", lifecycle: "setup", onboardingStep: "budget" },
  { label: "Wait for salary", lifecycle: "setup", onboardingStep: "wait_salary" },
  { label: "Open as live profile", lifecycle: "live" }
];

export function ContinueExistingSheetPage() {
  const { loading, error, deviceIdentity, restoreRemoteProfile, returnToWelcome } = useBluehourData();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [sheetInput, setSheetInput] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [discoveredSheets, setDiscoveredSheets] = useState<GoogleDriveFileSummary[]>([]);
  const [discoveryComplete, setDiscoveryComplete] = useState(false);
  const [inspection, setInspection] = useState<RemoteProfileInspection | null>(null);
  const [localHasData, setLocalHasData] = useState(false);
  const [localProfileId, setLocalProfileId] = useState<string | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [legacyChoiceIndex, setLegacyChoiceIndex] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const match = /^#connect=([a-zA-Z0-9-_]+)/.exec(window.location.hash);
    if (match?.[1]) {
      setSheetInput(match[1]);
      setManualMode(true);
    }
  }, []);

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
    return <div className="loading-state full-page-state">Opening recovery...</div>;
  }

  async function connectGoogle() {
    setBusy(true);
    setStatus(null);
    setInspection(null);
    setDiscoveredSheets([]);
    setDiscoveryComplete(false);
    try {
      if (!GOOGLE_CLIENT_ID) {
        throw new Error("Set VITE_GOOGLE_CLIENT_ID before connecting Google");
      }
      const token = await requestGoogleAccessToken(GOOGLE_CLIENT_ID);
      setAccessToken(token);
      const linkedSheetId = sheetInput.trim();
      if (linkedSheetId) {
        await loadInspection(linkedSheetId, token, "Google connected. The linked Bluehour profile was inspected.");
        setDiscoveryComplete(true);
        return;
      }

      const files = await listBluehourSpreadsheets(token);
      setDiscoveredSheets(files);
      setDiscoveryComplete(true);
      if (files.length === 0) {
        setManualMode(true);
        setStatus("Google connected. Bluehour could not find an app-accessible Sheet, so paste the link or ID as a fallback.");
        return;
      }
      if (files.length === 1) {
        await loadInspection(files[0].id, token, `Found ${files[0].name} and inspected the remote profile.`);
        return;
      }
      setStatus(`Found ${files.length} possible Bluehour Sheets. Choose one to preview before restoring this device.`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Google connection failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadInspection(input: string, token: string, successMessage: string) {
    const result = await inspectRemoteBluehourSheet(input, token);
    setSheetInput(result.spreadsheetId);
    setInspection(result);
    setStatus(successMessage);
  }

  async function inspectSheet(input = sheetInput) {
    setBusy(true);
    setStatus(null);
    setInspection(null);
    try {
      if (!accessToken) {
        throw new Error("Connect Google before inspecting the Sheet");
      }
      await loadInspection(input, accessToken, "Remote profile inspected. No data was written to the Sheet or this device.");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Sheet inspection failed");
    } finally {
      setBusy(false);
    }
  }

  async function restoreSheet() {
    setBusy(true);
    setStatus(null);
    try {
      if (!inspection) {
        throw new Error("Inspect a Sheet before restoring it");
      }
      if (!accessToken) {
        throw new Error("Reconnect Google before restoring");
      }
      if (localHasData && !replaceConfirmed) {
        throw new Error("Confirm replacement before changing this device");
      }
      const legacyChoice = inspection.manifest ? undefined : legacyChoices[legacyChoiceIndex];
      let restore = prepareRemoteRestore({
        inspection,
        now: new Date().toISOString(),
        appVersion: __BLUEHOUR_VERSION__,
        deviceId: deviceIdentity?.deviceId,
        legacyChoice
      });

      if (!inspection.manifest) {
        const nextRemoteRevision = inspection.remoteRevision + 1;
        await ensureBluehourSheetSchema(inspection.spreadsheetId, accessToken);
        await pushSnapshotToGoogleSheet(inspection.spreadsheetId, restore.snapshot, accessToken, fetch, nextRemoteRevision, inspection.remoteRevision);
        restore = prepareRemoteRestore({
          inspection: { ...inspection, remoteRevision: nextRemoteRevision },
          now: new Date().toISOString(),
          appVersion: __BLUEHOUR_VERSION__,
          deviceId: deviceIdentity?.deviceId,
          legacyChoice
        });
      }

      await restoreRemoteProfile(restore);
      clearInMemoryGoogleAccessToken();
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Remote restore failed");
    } finally {
      setBusy(false);
    }
  }

  const remoteProfileId = inspection?.manifest?.profileId ?? null;
  const differentProfile = Boolean(localHasData && localProfileId && remoteProfileId && localProfileId !== remoteProfileId);
  const restoreDisabled = !inspection || inspection.consistencyErrors.length > 0 || busy || (localHasData && !replaceConfirmed);

  return (
    <main className="welcome-screen">
      <section className="welcome-panel recovery-wizard">
        <div className="welcome-copy">
          <p className="eyebrow">Cross-device recovery</p>
          <h1>Continue with Google</h1>
          <p>
            Sign in and Bluehour will look for the private Sheet this app can access. Paste a link only if the Sheet is older, renamed, or shared
            from another account.
          </p>
        </div>

        {error ? <div className="alert-band danger">{error}</div> : null}
        {status ? <div className="alert-band">{status}</div> : null}

        <ol className="recovery-steps">
          <li className={accessToken ? "complete" : "active"}>
            <strong>1. Sign in to Google</strong>
            <small>Uses the existing narrow Drive file scope. Tokens stay in memory.</small>
            <button
              className="primary-action"
              type="button"
              onClick={() => void connectGoogle()}
              disabled={busy || !GOOGLE_CLIENT_ID}
              aria-label="Continue with Google"
            >
              <KeyRound size={16} aria-hidden="true" />
              <span>Continue with Google</span>
            </button>
          </li>
          <li className={inspection ? "complete" : accessToken ? "active" : ""}>
            <strong>2. Find the Bluehour Sheet</strong>
            <small>This searches app-accessible Google Sheets and never creates a new Sheet.</small>
            {discoveredSheets.length > 1 ? (
              <div className="sheet-choice-list" aria-label="Found Bluehour Sheets">
                {discoveredSheets.map((sheet) => (
                  <button
                    className={inspection?.spreadsheetId === sheet.id ? "sheet-choice-card active" : "sheet-choice-card"}
                    type="button"
                    key={sheet.id}
                    onClick={() => void inspectSheet(sheet.id)}
                    disabled={busy || !accessToken}
                  >
                    <span>
                      <strong>{sheet.name}</strong>
                      <small>{sheet.modifiedTime ? `Last modified ${formatDateTime(sheet.modifiedTime)}` : "Google did not report a modified time"}</small>
                    </span>
                    <Search size={16} aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : null}
            {discoveryComplete && discoveredSheets.length === 0 ? (
              <small>No app-accessible Bluehour Sheet appeared for this Google sign-in.</small>
            ) : null}
            {!manualMode && accessToken ? (
              <button className="secondary-action" type="button" onClick={() => setManualMode(true)} disabled={busy}>
                <Link size={16} aria-hidden="true" />
                Enter Sheet link or ID instead
              </button>
            ) : null}
            {manualMode ? (
              <div className="manual-sheet-entry">
                <label>
                  Sheet link or ID fallback
                  <input value={sheetInput} onChange={(event) => setSheetInput(event.target.value)} />
                </label>
                <button className="secondary-action" type="button" onClick={() => void inspectSheet()} disabled={busy || !accessToken || !sheetInput}>
                  <Search size={16} aria-hidden="true" />
                  Inspect profile
                </button>
              </div>
            ) : null}
          </li>
          <li className={inspection ? "active" : ""}>
            <strong>3. Preview profile</strong>
            {inspection ? <RemotePreview inspection={inspection} /> : <small>No remote data has been read yet.</small>}
          </li>
          <li className={inspection ? "active" : ""}>
            <strong>4. Confirm this device setup</strong>
            {inspection?.legacyInference ? (
              <label>
                Legacy resume choice
                <select value={legacyChoiceIndex} onChange={(event) => setLegacyChoiceIndex(Number.parseInt(event.target.value, 10))}>
                  {legacyChoices.map((choice, index) => (
                    <option key={choice.label} value={index}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {localHasData ? (
              <div className="alert-band danger">
                <strong>This device already contains a Bluehour live profile.</strong>
                <p>Export an encrypted backup before replacing it. Bluehour will not merge unrelated profile IDs silently.</p>
                {differentProfile ? <p>Remote and local profile IDs differ, so automatic sync is blocked.</p> : null}
                <label className="checkbox-label">
                  <input type="checkbox" checked={replaceConfirmed} onChange={(event) => setReplaceConfirmed(event.target.checked)} />
                  Replace this device with the inspected remote profile
                </label>
              </div>
            ) : (
              <small>This device does not contain meaningful live records. Remote restore can set it up atomically.</small>
            )}
          </li>
          <li className={inspection ? "active" : ""}>
            <strong>5. Download profile</strong>
            <button className="primary-action" type="button" onClick={() => void restoreSheet()} disabled={restoreDisabled}>
              <ShieldCheck size={16} aria-hidden="true" />
              {localHasData ? "Replace local profile with remote" : "Set up this device from remote profile"}
            </button>
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

function RemotePreview({ inspection }: { inspection: RemoteProfileInspection }) {
  const manifest = inspection.manifest;
  const lifecycle = manifest?.lifecycle ?? inspection.legacyInference?.lifecycle ?? "setup";
  const step = manifest?.onboardingStep ?? inspection.legacyInference?.onboardingStep;
  return (
    <div className="remote-preview" aria-label="Remote profile preview">
      <div className="data-row">
        <span>Profile</span>
        <strong>{manifest?.profileName ?? "Legacy Bluehour Sheet"}</strong>
      </div>
      <div className="data-row">
        <span>Status</span>
        <strong>
          {lifecycle === "setup" ? `Onboarding${step ? ` - ${step}` : ""}` : lifecycle === "ready_for_salary" ? "Ready for salary" : lifecycle}
        </strong>
      </div>
      <div className="data-row">
        <span>Currency</span>
        <strong>{manifest?.currency ?? "MYR"}</strong>
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
