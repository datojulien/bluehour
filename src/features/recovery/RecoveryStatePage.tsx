import { Download, ShieldAlert } from "lucide-react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { toCsv } from "../../domain/imports/csv";

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
