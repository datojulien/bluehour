import { useState, type FormEvent } from "react";
import { Copy, Download, KeyRound, Plus, RefreshCw, ShieldCheck, Unlink, Upload } from "lucide-react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { decryptBackup, encryptBackup, type EncryptedBackupEnvelope } from "../../data/backup/encryptedBackup";
import { clearInMemoryGoogleAccessToken, requestGoogleAccessToken } from "../../data/google/googleAuth";
import {
  createBluehourSpreadsheet,
  createConnectionDescriptor,
  ensureBluehourSheetSchema,
  extractSpreadsheetId,
  parseConnectionDescriptor
} from "../../data/google/googleSheetsAdapter";
import { pushSnapshotToGoogleSheet, readSnapshotFromGoogleSheet, RemoteRevisionChangedError } from "../../data/google/sheetSerialization";
import type { LocalMutation, MutableStoreName } from "../../data/local-db/localDb";
import { startFirstSalaryCycle } from "../../domain/forecasting/cycleCommands";
import { planGoogleSheetSync } from "../../data/sync/googleSync";
import { toCsv } from "../../domain/imports/csv";
import { parseMoneyInput } from "../../domain/money";
import { createRecordMeta, touchRecord } from "../../domain/records";
import type { Account, AppSettings, BalanceSnapshot, BluehourSnapshot, ConflictRecord, SyncState } from "../../domain/types";
import { isActive } from "../../domain/types";
import { readProfileManifest } from "../../domain/profileManifest";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export function SettingsPage() {
  const { snapshot, asOfDate, deviceIdentity, loading, error, saveRecord, saveRecords, restoreProfileSnapshot, applyRemoteSync, markSynced, isDemo, canUseGoogleSync } =
    useBluehourData();
  const [message, setMessage] = useState<string | null>(null);

  if (loading) {
    return <div className="loading-state">Opening settings…</div>;
  }

  if (error || !snapshot) {
    return (
      <section className="empty-state">
        <h1>Settings</h1>
        <p>{error ?? "Settings are unavailable."}</p>
      </section>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Setup and portability</p>
          <h1>Settings</h1>
        </div>
        <div className="date-chip">Bluehour {__BLUEHOUR_VERSION__}</div>
      </div>

      {message ? <section className="alert-band">{message}</section> : null}

      <section className="two-column">
        <AccountForm
          date={asOfDate}
          onSave={async ({ account, balanceSnapshot }) => {
            await saveRecords(
              [
                { storeName: "accounts", record: account },
                { storeName: "balanceSnapshots", record: balanceSnapshot }
              ],
              "account"
            );
            setMessage("Account saved without account numbers.");
          }}
        />
        <GoogleSettings
          snapshot={snapshot}
          deviceId={deviceIdentity?.deviceId}
          canUseGoogleSync={canUseGoogleSync}
          onSave={async (setting) => {
            await saveRecord("settings", setting, "Google connection");
            setMessage("Google connection descriptor saved locally. No token was stored.");
          }}
          onSaveRecords={saveRecords}
          onApplyRemoteSync={applyRemoteSync}
          onMarkSynced={markSynced}
          onPushed={() => setMessage("Local snapshot pushed to Google Sheet with RAW values.")}
        />
      </section>

      {snapshot.budgetCycles.some((cycle) => cycle.status === "open") ? (
        <section className="dashboard-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">Onboarding</p>
              <h2>Salary cycle already started</h2>
            </div>
          </div>
          <p>The live profile already has an open salary cycle. Use Review to close it when the next main salary arrives.</p>
        </section>
      ) : (
        <StartCycleSetupPanel
          date={asOfDate}
          accounts={snapshot.accounts.filter(isActive)}
          incomeCategoryId={snapshot.categories.find((category) => category.name === "Income")?.id ?? "cat-income"}
          existingCycles={snapshot.budgetCycles}
          onSave={async (records) => {
            await saveRecords(
              [
                { storeName: "balanceSnapshots", record: records.openingSnapshot },
                { storeName: "transactions", record: records.salaryTransaction },
                { storeName: "transactionLegs", record: records.salaryLeg },
                { storeName: "transactionSplits", record: records.salarySplit },
                { storeName: "budgetCycles", record: records.cycle }
              ],
              "first salary cycle"
            );
            setMessage("Salary cycle started from the actual salary arrival.");
          }}
        />
      )}

      <ConflictReviewPanel
        conflicts={snapshot.conflicts.filter((conflict) => conflict.status === "open")}
        onChooseRemote={async (conflict) => {
          const remoteRecord = JSON.parse(conflict.remoteJson) as object;
          const resolved = { ...touchRecord(conflict), status: "resolved" as const };
          await applyRemoteSync({
            mutations: [{ storeName: conflict.tableName as MutableStoreName, record: remoteRecord as never, outbox: false }],
            conflicts: [resolved],
            syncState: {
              key: "google",
              status: "waiting_to_sync",
              remoteRevision: snapshot.syncState.find((state) => state.key === "google")?.remoteRevision,
              message: "Remote version accepted for one conflict."
            },
            clearOutbox: false
          });
          setMessage("Remote version accepted.");
        }}
        onChooseLocal={async (conflict) => {
          const localRecord = JSON.parse(conflict.localJson) as object;
          const resolved = { ...touchRecord(conflict), status: "resolved" as const };
          await saveRecords(
            [
              { storeName: conflict.tableName as MutableStoreName, record: localRecord as never },
              { storeName: "conflicts", record: resolved, outbox: false }
            ],
            "conflict resolution"
          );
          setMessage("Local version kept and queued for sync.");
        }}
      />

      <section className="two-column">
        <BackupPanel
          snapshot={snapshot}
          isDemo={isDemo}
          profileLabel={isDemo ? "fictional demonstration profile" : "live profile"}
          onRestore={async (restored) => {
            await restoreProfileSnapshot(restored);
            setMessage("Encrypted backup atomically replaced the current local profile.");
          }}
        />
        <CsvExportPanel snapshot={snapshot} isDemo={isDemo} />
      </section>

      <section className="dashboard-band">
        <div className="band-header">
          <div>
            <p className="eyebrow">Accounts</p>
            <h2>Local account list</h2>
          </div>
        </div>
        <div className="data-table">
          <div className="data-row header">
            <span>Name</span>
            <span>Type</span>
            <span>Role</span>
            <span>Tracking</span>
            <span>Reconcile</span>
          </div>
          {snapshot.accounts.filter(isActive).map((account) => (
            <div className="data-row" key={account.id}>
              <span>
                <strong>{account.name}</strong>
                <small>{account.institutionLabel ?? "No institution label"}</small>
              </span>
              <span>{account.type}</span>
              <span>{account.role}</span>
              <span>{account.trackingMode}</span>
              <span>{account.reconcileWeekly ? "weekly" : "off"}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function StartCycleSetupPanel({
  date,
  accounts,
  incomeCategoryId,
  existingCycles,
  onSave
}: {
  date: string;
  accounts: Account[];
  incomeCategoryId: string;
  existingCycles: Parameters<typeof startFirstSalaryCycle>[0]["existingCycles"];
  onSave: (records: ReturnType<typeof startFirstSalaryCycle>) => Promise<void>;
}) {
  const [salaryDate, setSalaryDate] = useState(date);
  const [salaryDeposit, setSalaryDeposit] = useState("");
  const [currentBalance, setCurrentBalance] = useState("");
  const [destinationAccountId, setDestinationAccountId] = useState(accounts[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSave(
        startFirstSalaryCycle({
          salaryDate: salaryDate as ReturnType<typeof startFirstSalaryCycle>["cycle"]["startedOn"],
          salaryDepositText: salaryDeposit,
          currentBalanceText: currentBalance,
          destinationAccountId,
          incomeCategoryId,
          existingCycles
        })
      );
      setSalaryDeposit("");
      setCurrentBalance("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start salary cycle");
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Onboarding</p>
          <h2>Start first salary cycle</h2>
        </div>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label>
          Salary date
          <input type="date" value={salaryDate} onChange={(event) => setSalaryDate(event.target.value)} required />
        </label>
        <label>
          Salary deposit
          <input value={salaryDeposit} onChange={(event) => setSalaryDeposit(event.target.value)} inputMode="decimal" required />
        </label>
        <label>
          Current balance
          <input value={currentBalance} onChange={(event) => setCurrentBalance(event.target.value)} inputMode="decimal" required />
        </label>
        <label className="span-2">
          Destination account
          <select value={destinationAccountId} onChange={(event) => setDestinationAccountId(event.target.value)}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        {error ? <p className="form-error span-3">{error}</p> : null}
        <div className="form-actions span-3">
          <button className="primary-action" type="submit">
            Start cycle
          </button>
        </div>
      </form>
    </section>
  );
}

function AccountForm({ date, onSave }: { date: string; onSave: (records: { account: Account; balanceSnapshot: BalanceSnapshot }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<Account["type"]>("bank");
  const [role, setRole] = useState<Account["role"]>("spendable");
  const [trackingMode, setTrackingMode] = useState<Account["trackingMode"]>("ledger");
  const [institutionLabel, setInstitutionLabel] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [reconcileWeekly, setReconcileWeekly] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const account: Account = {
        ...createRecordMeta("acc"),
        name,
        type,
        role,
        trackingMode,
        currency: "MYR",
        institutionLabel: institutionLabel || undefined,
        reconcileWeekly,
        sortOrder: Date.now()
      };
      const balanceSnapshot: BalanceSnapshot = {
        ...createRecordMeta("bal"),
        accountId: account.id,
        asOfDate: date as BalanceSnapshot["asOfDate"],
        amountMinor: parseMoneyInput(openingBalance),
        source: trackingMode === "ledger" ? "opening" : "manual_valuation"
      };
      await onSave({ account, balanceSnapshot });
      setName("");
      setOpeningBalance("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save account");
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Accounts</p>
          <h2>Add account</h2>
        </div>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label className="span-2">
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Type
          <select value={type} onChange={(event) => setType(event.target.value as Account["type"])}>
            {["bank", "savings", "cash", "ewallet", "credit_card", "loan", "investment", "property", "vehicle", "other"].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value as Account["role"])}>
            {["spendable", "protected", "investment", "asset", "liability"].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tracking
          <select value={trackingMode} onChange={(event) => setTrackingMode(event.target.value as Account["trackingMode"])}>
            <option value="ledger">ledger</option>
            <option value="manual_snapshot">manual snapshot</option>
            <option value="hybrid">hybrid</option>
          </select>
        </label>
        <label>
          Opening value
          <input value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} inputMode="decimal" required />
        </label>
        <label className="span-2">
          Institution label
          <input value={institutionLabel} onChange={(event) => setInstitutionLabel(event.target.value)} />
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={reconcileWeekly} onChange={(event) => setReconcileWeekly(event.target.checked)} />
          Weekly reconciliation
        </label>
        {error ? <p className="form-error span-3">{error}</p> : null}
        <div className="form-actions span-3">
          <button className="primary-action" type="submit">
            <Plus size={16} aria-hidden="true" />
            Save account
          </button>
        </div>
      </form>
    </section>
  );
}

function GoogleSettings({
  snapshot,
  deviceId,
  canUseGoogleSync,
  onSave,
  onSaveRecords,
  onApplyRemoteSync,
  onMarkSynced,
  onPushed
}: {
  snapshot: BluehourSnapshot;
  deviceId?: string;
  canUseGoogleSync: boolean;
  onSave: (setting: AppSettings) => Promise<void>;
  onSaveRecords: (mutations: LocalMutation[], label?: string) => Promise<void>;
  onApplyRemoteSync: (args: {
    mutations: LocalMutation[];
    conflicts: ConflictRecord[];
    syncState: SyncState;
    clearOutbox: boolean;
  }) => Promise<void>;
  onMarkSynced: (syncState: SyncState) => Promise<void>;
  onPushed: () => void;
}) {
  const existing = snapshot.settings.find((setting) => setting.key === "googleConnection" && !setting.archivedAt);
  const manifest = readProfileManifest(snapshot.settings);
  const existingValue = existing ? connectionDescriptorFromSetting(existing) : null;
  const syncState = snapshot.syncState.find((state) => state.key === "google");
  const [spreadsheetInput, setSpreadsheetInput] = useState(existingValue?.spreadsheetId ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingLocalChanges = snapshot.outboxOperations.length;
  const openConflicts = snapshot.conflicts.filter((conflict) => conflict.status === "open").length;

  async function saveSpreadsheetId(spreadsheetId: string) {
    if (!canUseGoogleSync) {
      throw new Error("Demonstration data cannot be connected to Google Sheets");
    }
    if (!manifest) {
      throw new Error("Profile manifest is missing");
    }
    const descriptor = createConnectionDescriptor(extractSpreadsheetId(spreadsheetId), {
      profileId: manifest.profileId,
      lastKnownRemoteRevision: syncState?.remoteRevision ?? existingValue?.lastKnownRemoteRevision ?? 0,
      lastSuccessfulSyncAt: syncState?.lastSyncedAt
    });
    const setting: AppSettings = existing
      ? { ...touchRecord(existing), valueJson: JSON.stringify(descriptor) }
      : {
          ...createRecordMeta("settings"),
          key: "googleConnection",
          valueJson: JSON.stringify(descriptor)
        };
    await onSave(setting);
  }

  async function createSheet() {
    setBusy(true);
    setStatus(null);
    try {
      if (!canUseGoogleSync) {
        throw new Error("Demonstration data cannot create or sync a Google Sheet");
      }
      if (!GOOGLE_CLIENT_ID) {
        throw new Error("Set VITE_GOOGLE_CLIENT_ID before creating a Google Sheet");
      }
      const token = await requestGoogleAccessToken(GOOGLE_CLIENT_ID);
      const spreadsheetId = await createBluehourSpreadsheet(token);
      await saveSpreadsheetId(spreadsheetId);
      setSpreadsheetInput(spreadsheetId);
      setStatus("Google Sheet created. Press Sync now to commit this profile before using it on another device.");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Google connection failed");
    } finally {
      clearInMemoryGoogleAccessToken();
      setBusy(false);
    }
  }

  async function pushToSheet() {
    setBusy(true);
    setStatus(null);
    try {
      if (!canUseGoogleSync) {
        throw new Error("Demonstration data cannot be pushed to Google Sheets");
      }
      if (!GOOGLE_CLIENT_ID) {
        throw new Error("Set VITE_GOOGLE_CLIENT_ID before pushing to Google Sheets");
      }
      const spreadsheetId = extractSpreadsheetId(spreadsheetInput);
      if (!spreadsheetId) {
        throw new Error("Save or enter a spreadsheet ID first");
      }
      const token = await requestGoogleAccessToken(GOOGLE_CLIENT_ID);
      await ensureBluehourSheetSchema(spreadsheetId, token);
      const expectedRemoteRevision = syncState?.remoteRevision ?? existingValue?.lastKnownRemoteRevision ?? 0;
      const nextRemoteRevision = expectedRemoteRevision + 1;
      await pushSnapshotToGoogleSheet(spreadsheetId, snapshot, token, fetch, nextRemoteRevision, expectedRemoteRevision);
      await onMarkSynced({
        key: "google",
        status: "synced",
        spreadsheetId,
        profileId: manifest?.profileId,
        remoteRevision: nextRemoteRevision,
        lastSyncedAt: new Date().toISOString(),
        lastRemoteWriterDeviceId: deviceId,
        message: "Local snapshot pushed to Google Sheet."
      });
      setStatus("Local snapshot pushed. Access token was cleared from memory after the action.");
      onPushed();
    } catch (caught) {
      setStatus(syncFailureMessage(caught, "Google push failed"));
    } finally {
      clearInMemoryGoogleAccessToken();
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setStatus(null);
    try {
      if (!canUseGoogleSync) {
        throw new Error("Demonstration data cannot be synced with Google Sheets");
      }
      if (!GOOGLE_CLIENT_ID) {
        throw new Error("Set VITE_GOOGLE_CLIENT_ID before syncing Google Sheets");
      }
      const spreadsheetId = extractSpreadsheetId(spreadsheetInput);
      if (!spreadsheetId) {
        throw new Error("Save or enter a spreadsheet ID first");
      }
      const token = await requestGoogleAccessToken(GOOGLE_CLIENT_ID);
      const remote = await readSnapshotFromGoogleSheet(spreadsheetId, token);
      const plan = planGoogleSheetSync(snapshot, remote);
      const syncState = {
        ...plan.syncState,
        spreadsheetId,
        profileId: manifest?.profileId,
        lastRemoteWriterDeviceId: remote.lastWrittenByDeviceId
      };

      if (plan.action === "push_local") {
        await ensureBluehourSheetSchema(spreadsheetId, token);
        await pushSnapshotToGoogleSheet(spreadsheetId, snapshot, token, fetch, plan.nextRemoteRevision, plan.remoteRevision);
        await onMarkSynced({
          ...syncState,
          status: "synced",
          remoteRevision: plan.nextRemoteRevision,
          lastSyncedAt: new Date().toISOString(),
          lastRemoteWriterDeviceId: deviceId,
          message: "Local outbox pushed to Google Sheet."
        });
        setStatus("Local outbox pushed to Google Sheet.");
      } else {
        await onApplyRemoteSync({
          mutations: plan.mutations,
          conflicts: plan.conflicts,
          syncState,
          clearOutbox: plan.clearOutbox
        });
        setStatus(plan.syncState.message ?? "Sync complete.");
      }
    } catch (caught) {
      setStatus(syncFailureMessage(caught, "Google sync failed"));
    } finally {
      clearInMemoryGoogleAccessToken();
      setBusy(false);
    }
  }

  async function checkForChanges() {
    setBusy(true);
    setStatus(null);
    try {
      if (!canUseGoogleSync) {
        throw new Error("Demonstration data cannot be synced with Google Sheets");
      }
      if (!GOOGLE_CLIENT_ID) {
        throw new Error("Set VITE_GOOGLE_CLIENT_ID before checking Google Sheets");
      }
      const spreadsheetId = extractSpreadsheetId(spreadsheetInput);
      if (!spreadsheetId) {
        throw new Error("Save or enter a spreadsheet ID first");
      }
      const token = await requestGoogleAccessToken(GOOGLE_CLIENT_ID);
      const remote = await readSnapshotFromGoogleSheet(spreadsheetId, token);
      const plan = planGoogleSheetSync(snapshot, remote);
      const localRevision = syncState?.remoteRevision ?? 0;
      const summary =
        plan.action === "no_op"
          ? "No remote changes."
          : plan.action === "apply_remote" && pendingLocalChanges > 0
            ? "Both devices changed data. Sync now will pull remote changes first and keep local changes waiting."
            : plan.action === "apply_remote"
              ? "Remote changes available."
              : plan.action === "conflict"
                ? "Conflict review required."
                : plan.action === "cross_profile_blocked"
                  ? "Different remote profile ID. Automatic merge is blocked."
                  : plan.action === "read_only_recovery"
                    ? "Remote Sheet requires read-only recovery."
                    : remote.remoteRevision > localRevision
                      ? "Remote changes available before local push."
                      : pendingLocalChanges > 0
                        ? "Local changes waiting."
                        : "No remote changes.";
      setStatus(`${summary} Remote revision ${remote.remoteRevision}.`);
    } catch (caught) {
      setStatus(syncFailureMessage(caught, "Google check failed"));
    } finally {
      clearInMemoryGoogleAccessToken();
      setBusy(false);
    }
  }

  function downloadDescriptor() {
    if (!manifest) {
      setStatus("Profile manifest is missing.");
      return;
    }
    const descriptor = createConnectionDescriptor(extractSpreadsheetId(spreadsheetInput), {
      profileId: manifest.profileId,
      lastKnownRemoteRevision: syncState?.remoteRevision ?? existingValue?.lastKnownRemoteRevision ?? 0,
      lastSuccessfulSyncAt: syncState?.lastSyncedAt
    });
    downloadJson("bluehour-connection-descriptor.json", descriptor);
  }

  async function copyConnectionInfo() {
    if (!spreadsheetInput) {
      setStatus("Enter or create a Sheet first.");
      return;
    }
    const spreadsheetId = extractSpreadsheetId(spreadsheetInput);
    const connectionLink = `${window.location.origin}${window.location.pathname}#connect=${spreadsheetId}`;
    const text = [
      "Moving from laptop to desktop",
      "1. On this device, press Sync now and confirm Bluehour says Saved to Google.",
      "2. On the other device, open the same hosted Bluehour app.",
      "3. Choose Continue from an existing Bluehour Sheet.",
      `4. Paste this Sheet ID: ${spreadsheetId}`,
      `Connection link: ${connectionLink}`,
      "Google sign-in is still required; this link is not authorisation."
    ].join("\n");
    await navigator.clipboard?.writeText(text);
    setStatus("Connection instructions copied.");
  }

  async function disconnectDevice() {
    if (!existing) {
      setStatus("This device is not connected to a Google Sheet.");
      return;
    }
    const archivedConnection = {
      ...touchRecord(existing),
      archivedAt: new Date().toISOString()
    };
    await onSaveRecords(
      [
        { storeName: "settings", record: archivedConnection, outbox: false },
        {
          storeName: "syncState",
          record: {
            key: "google",
            status: "saved_locally",
            message: pendingLocalChanges > 0 ? "Disconnected. Unsynchronised local changes remain only on this device." : "Disconnected. Local data was preserved."
          },
          outbox: false
        }
      ],
      "Google disconnect"
    );
    clearInMemoryGoogleAccessToken();
    setSpreadsheetInput("");
    setStatus("This device was disconnected. Local data and the remote Sheet were preserved.");
  }

  async function prepareSheetSchema() {
    setBusy(true);
    setStatus(null);
    try {
      if (!canUseGoogleSync) {
        throw new Error("Demonstration data cannot prepare a Google Sheet");
      }
      if (!GOOGLE_CLIENT_ID) {
        throw new Error("Set VITE_GOOGLE_CLIENT_ID before preparing Google Sheets");
      }
      const spreadsheetId = extractSpreadsheetId(spreadsheetInput);
      if (!spreadsheetId) {
        throw new Error("Save or enter a spreadsheet ID first");
      }
      const token = await requestGoogleAccessToken(GOOGLE_CLIENT_ID);
      const missing = await ensureBluehourSheetSchema(spreadsheetId, token);
      setStatus(missing.length === 0 ? "Google Sheet already has all Bluehour tabs." : `Added ${missing.length} missing Bluehour tabs.`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Google schema preparation failed");
    } finally {
      clearInMemoryGoogleAccessToken();
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Google</p>
          <h2>Private Sheet connection</h2>
        </div>
      </div>
      <div className="stack-list">
        {!canUseGoogleSync ? <p className="form-note danger-text">Google sync is disabled for the fictional demonstration profile.</p> : null}
        <p>Tokens are requested only after a user action and are kept in memory only.</p>
        <div className="sync-summary-grid">
          <div>
            <small>Connected Sheet</small>
            <strong>{existingValue?.spreadsheetId ? shortId(existingValue.spreadsheetId) : "Not connected"}</strong>
          </div>
          <div>
            <small>Profile ID</small>
            <strong>{manifest?.profileId ? shortId(manifest.profileId) : "Missing"}</strong>
          </div>
          <div>
            <small>Local device ID</small>
            <strong>{deviceId ? shortId(deviceId) : "Creating"}</strong>
          </div>
          <div>
            <small>Local status</small>
            <strong>{syncState?.status ?? "saved_locally"}</strong>
          </div>
          <div>
            <small>Remote revision</small>
            <strong>{syncState?.remoteRevision ?? existingValue?.lastKnownRemoteRevision ?? 0}</strong>
          </div>
          <div>
            <small>Last sync</small>
            <strong>{syncState?.lastSyncedAt ? syncState.lastSyncedAt.slice(0, 16).replace("T", " ") : "Never"}</strong>
          </div>
          <div>
            <small>Pending local changes</small>
            <strong>{pendingLocalChanges}</strong>
          </div>
          <div>
            <small>Open conflicts</small>
            <strong>{openConflicts}</strong>
          </div>
          <div>
            <small>Last remote writer</small>
            <strong>{syncState?.lastRemoteWriterDeviceId ? shortId(syncState.lastRemoteWriterDeviceId) : "Unknown"}</strong>
          </div>
          <div>
            <small>Cross-device recovery</small>
            <strong>{existingValue ? "Enabled after sync" : "Local only"}</strong>
          </div>
        </div>
        <label>
          Existing Sheet URL or ID
          <input value={spreadsheetInput} onChange={(event) => setSpreadsheetInput(event.target.value)} />
        </label>
        <div className="form-actions">
          <button className="secondary-action" type="button" onClick={() => void saveSpreadsheetId(spreadsheetInput)} disabled={!canUseGoogleSync}>
            <KeyRound size={16} aria-hidden="true" />
            Save descriptor
          </button>
          <button className="secondary-action" type="button" onClick={downloadDescriptor} disabled={!spreadsheetInput || !canUseGoogleSync}>
            <Download size={16} aria-hidden="true" />
            Download descriptor
          </button>
          <button className="secondary-action" type="button" onClick={() => void copyConnectionInfo()} disabled={!spreadsheetInput || !canUseGoogleSync}>
            <Copy size={16} aria-hidden="true" />
            Copy Sheet connection information
          </button>
          <button className="primary-action" type="button" onClick={() => void createSheet()} disabled={busy || !canUseGoogleSync}>
            Create Sheet
          </button>
          <button className="secondary-action" type="button" onClick={() => void prepareSheetSchema()} disabled={busy || !spreadsheetInput || !canUseGoogleSync}>
            Prepare tabs
          </button>
          <button className="secondary-action" type="button" onClick={() => void checkForChanges()} disabled={busy || !spreadsheetInput || !canUseGoogleSync}>
            <RefreshCw size={16} aria-hidden="true" />
            Check for changes
          </button>
          <button className="primary-action" type="button" onClick={() => void pushToSheet()} disabled={busy || !spreadsheetInput || !canUseGoogleSync}>
            Push local snapshot
          </button>
          <button className="primary-action" type="button" onClick={() => void syncNow()} disabled={busy || !spreadsheetInput || !canUseGoogleSync}>
            Sync now
          </button>
          <button className="secondary-action danger-action" type="button" onClick={() => void disconnectDevice()} disabled={busy || !existing || !canUseGoogleSync}>
            <Unlink size={16} aria-hidden="true" />
            Disconnect this device
          </button>
        </div>
        <div className="continue-device-card">
          <strong>Continue on another device</strong>
          <p>
            Sync this device first, then open the same hosted Bluehour app elsewhere and choose Continue from an existing Bluehour Sheet. Google
            access still controls the Sheet.
          </p>
        </div>
        {status ? <p className="form-note">{status}</p> : null}
      </div>
    </section>
  );
}

function ConflictReviewPanel({
  conflicts,
  onChooseRemote,
  onChooseLocal
}: {
  conflicts: ConflictRecord[];
  onChooseRemote: (conflict: ConflictRecord) => Promise<void>;
  onChooseLocal: (conflict: ConflictRecord) => Promise<void>;
}) {
  if (conflicts.length === 0) {
    return null;
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Conflict review</p>
          <h2>Choose a version</h2>
        </div>
      </div>
      <div className="stack-list">
        {conflicts.map((conflict) => (
          <div className="conflict-card" key={conflict.id}>
            <div>
              <strong>
                {conflict.tableName} · {conflict.recordId}
              </strong>
              <small>Bluehour never resolves financial conflicts silently.</small>
            </div>
            <div className="conflict-grid">
              <pre>{prettyJson(conflict.localJson)}</pre>
              <pre>{prettyJson(conflict.remoteJson)}</pre>
            </div>
            <div className="form-actions">
              <button className="secondary-action" type="button" onClick={() => void onChooseRemote(conflict)}>
                Choose remote
              </button>
              <button className="primary-action" type="button" onClick={() => void onChooseLocal(conflict)}>
                Keep local
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BackupPanel({
  snapshot,
  isDemo,
  profileLabel,
  onRestore
}: {
  snapshot: BluehourSnapshot;
  isDemo: boolean;
  profileLabel: string;
  onRestore: (snapshot: BluehourSnapshot) => Promise<void>;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [restoreText, setRestoreText] = useState("");
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function exportBackup() {
    try {
      const envelope = await encryptBackup(snapshot, passphrase);
      downloadJson(isDemo ? "bluehour-fictional-demo-encrypted-backup.json" : "bluehour-live-encrypted-backup.json", envelope);
      setMessage("Encrypted backup created. The passphrase was not stored.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Backup failed");
    }
  }

  async function restoreBackup() {
    try {
      if (!restoreConfirmed) {
        throw new Error("Confirm that restore should replace the current profile");
      }
      const restored = await decryptBackup(JSON.parse(restoreText) as EncryptedBackupEnvelope, passphrase);
      await onRestore(restored);
      setMessage("Backup decrypted and restored.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Restore failed");
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Backup</p>
          <h2>Encrypted JSON</h2>
        </div>
      </div>
      <div className="stack-list">
        <label>
          Passphrase
          <input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
        </label>
        <div className="form-actions">
          <button className="primary-action" type="button" onClick={() => void exportBackup()}>
            <ShieldCheck size={16} aria-hidden="true" />
            Download encrypted backup
          </button>
        </div>
        <label>
          Restore envelope
          <textarea rows={4} value={restoreText} onChange={(event) => setRestoreText(event.target.value)} />
        </label>
        <p className="form-note danger-text">Restore replaces the current {profileLabel} after validation. It is not merged with existing local data.</p>
        <label className="checkbox-label">
          <input type="checkbox" checked={restoreConfirmed} onChange={(event) => setRestoreConfirmed(event.target.checked)} />
          Replace this {profileLabel}
        </label>
        <button className="secondary-action" type="button" onClick={() => void restoreBackup()} disabled={!restoreConfirmed}>
          <Upload size={16} aria-hidden="true" />
          Restore backup
        </button>
        {message ? <p className="form-note">{message}</p> : null}
      </div>
    </section>
  );
}

function CsvExportPanel({ snapshot, isDemo }: { snapshot: BluehourSnapshot; isDemo: boolean }) {
  const prefix = isDemo ? "bluehour-fictional-demo" : "bluehour-live";

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Exports</p>
          <h2>Readable CSV files</h2>
        </div>
      </div>
      <div className="stack-list">
        <button className="secondary-action" type="button" onClick={() => downloadText(`${prefix}-accounts.csv`, toCsv(["id", "name", "type", "role"], snapshot.accounts))}>
          Accounts CSV
        </button>
        <button className="secondary-action" type="button" onClick={() => downloadText(`${prefix}-transactions.csv`, toCsv(["id", "occurredOn", "description", "type"], snapshot.transactions))}>
          Transactions CSV
        </button>
        <button className="secondary-action" type="button" onClick={() => downloadText(`${prefix}-budgets.csv`, toCsv(["id", "budgetCycleId", "categoryId", "baseAmountMinor"], snapshot.budgetAllocations))}>
          Budgets CSV
        </button>
        <button className="secondary-action" type="button" onClick={() => downloadText(`${prefix}-plans.csv`, toCsv(["id", "name", "expectedDate", "expectedAmountMinor", "status"], snapshot.planInstances))}>
          Plans CSV
        </button>
        <button className="secondary-action" type="button" onClick={() => downloadText(`${prefix}-subscriptions.csv`, toCsv(["id", "provider", "billingFrequency", "nextPaymentDate"], snapshot.subscriptions))}>
          Subscriptions CSV
        </button>
      </div>
    </section>
  );
}

function prettyJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

function connectionDescriptorFromSetting(setting: AppSettings) {
  try {
    return parseConnectionDescriptor(JSON.parse(setting.valueJson));
  } catch {
    try {
      const legacy = JSON.parse(setting.valueJson) as { spreadsheetId?: string; schemaVersion?: number };
      return legacy.spreadsheetId
        ? {
            spreadsheetId: legacy.spreadsheetId,
            sheetSchemaVersion: legacy.schemaVersion ?? 1,
            profileId: "",
            lastKnownRemoteRevision: 0
          }
        : null;
    } catch {
      return null;
    }
  }
}

function syncFailureMessage(caught: unknown, fallback: string): string {
  if (caught instanceof RemoteRevisionChangedError) {
    return "Remote changes were detected before push. Check for changes, pull or resolve conflicts, then sync again.";
  }
  return caught instanceof Error ? caught.message : fallback;
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`;
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
