import { Download, ShieldAlert } from "lucide-react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { toCsv } from "../../domain/imports/csv";
import { readProfileManifest } from "../../domain/profileManifest";
import { inspectProfileHealth } from "../../domain/profileHealth";
import type { AppSettings } from "../../domain/types";

export function RecoveryStatePage() {
  const { snapshot, loading, error, profileLabel, returnToWelcome } = useBluehourData();

  if (loading) {
    return <div className="loading-state full-page-state">Opening recovery mode...</div>;
  }

  if (error || !snapshot) {
    return (
      <main className="welcome-screen">
        <section className="empty-state">
          <h1>Read-only recovery</h1>
          <p>{error ?? "Profile data is unavailable."}</p>
          <button className="secondary-action" type="button" onClick={() => void returnToWelcome()}>
            Return to welcome
          </button>
        </section>
      </main>
    );
  }

  const prefix = profileLabel.toLowerCase().includes("demo") ? "bluehour-fictional-demo-recovery" : "bluehour-live-recovery";
  const manifest = safeReadManifest(snapshot.settings);
  const health = inspectProfileHealth({ snapshot, manifest });
  const syncState = snapshot.syncState.find((state) => state.key === "google");

  return (
    <main className="welcome-screen">
      <section className="dashboard-band recovery-panel">
        <div className="band-header">
          <div>
            <p className="eyebrow">Recovery</p>
            <h1>Read-only recovery</h1>
          </div>
          <ShieldAlert size={22} aria-hidden="true" />
        </div>
        <div className="stack-list">
          <p>Bluehour detected a schema or sync problem. Writes are paused so the local profile cannot drift further while you export data.</p>
          <section className="dashboard-subsection" aria-label="Profile Health">
            <h2>Profile Health</h2>
            <div className="sync-summary-grid">
              <RecoveryMetric label="Local profile" value={health.status === "healthy" ? "healthy" : "needs repair"} />
              <RecoveryMetric label="Manifest lifecycle" value={health.manifestLifecycle} />
              <RecoveryMetric label="Onboarding step" value={health.onboardingStep ?? "none"} />
              <RecoveryMetric label="Open salary cycles" value={String(health.openCycleCount)} />
              <RecoveryMetric label="Closed salary cycles" value={String(health.closedCycleCount)} />
              <RecoveryMetric label="Remote vault" value={syncState?.provider === "drive_appdata" ? syncState.status : "not connected"} />
              <RecoveryMetric label="Remote revision" value={String(syncState?.remoteRevision ?? 0)} />
              <RecoveryMetric label="Pending local changes" value={String(snapshot.outboxOperations.length)} />
            </div>
            {health.issues.map((issue) => (
              <p className={issue.severity === "danger" ? "form-error" : "form-note"} key={issue.id}>
                {issue.title}
              </p>
            ))}
            <details>
              <summary>Advanced diagnostics</summary>
              <pre>
                {JSON.stringify(
                  {
                    status: health.status,
                    issues: health.issues.map((issue) => issue.id),
                    openCycleCount: health.openCycleCount,
                    closedCycleCount: health.closedCycleCount,
                    remoteRevision: syncState?.remoteRevision ?? 0
                  },
                  null,
                  2
                )}
              </pre>
            </details>
          </section>
          <div className="form-actions">
            <button className="primary-action" type="button" onClick={() => downloadJson(`${prefix}-snapshot.json`, snapshot)}>
              <Download size={16} aria-hidden="true" />
              Snapshot JSON
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => downloadText(`${prefix}-transactions.csv`, toCsv(["id", "occurredOn", "description", "type"], snapshot.transactions))}
            >
              Transactions CSV
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => downloadText(`${prefix}-accounts.csv`, toCsv(["id", "name", "type", "role"], snapshot.accounts))}
            >
              Accounts CSV
            </button>
          </div>
          <button className="secondary-action" type="button" onClick={() => void returnToWelcome()}>
            Return to welcome
          </button>
        </div>
      </section>
    </main>
  );
}

function RecoveryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function safeReadManifest(settings: readonly AppSettings[]) {
  try {
    return readProfileManifest(settings);
  } catch {
    return null;
  }
}

function downloadJson(fileName: string, value: unknown) {
  downloadText(fileName, JSON.stringify(value, null, 2), "application/json");
}

function downloadText(fileName: string, text: string, type = "text/csv") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
