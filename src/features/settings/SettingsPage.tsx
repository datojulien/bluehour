import { useState, type FormEvent } from "react";
import { Download, Plus, RefreshCw, ShieldCheck, Trash2, Unlink, Upload } from "lucide-react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { decryptBackup, encryptBackup, type EncryptedBackupEnvelope } from "../../data/backup/encryptedBackup";
import {
  DRIVE_VAULT_SCHEMA_VERSION,
  createDriveConnectionDescriptor,
  driveVaultFilesFromDescriptor,
  driveVaultFilesFromSyncState,
  ensureDriveVaultFiles,
  parseDriveConnectionDescriptor,
  pushSnapshotToDriveVault,
  readSnapshotFromDriveVault,
  RemoteRevisionChangedError,
  type DriveConnectionDescriptor,
  type DriveVaultFiles
} from "../../data/google/driveAppDataVault";
import {
  GOOGLE_SHEETS_SCOPES,
  clearInMemoryGoogleAccessToken,
  fetchGoogleAccountProfile,
  getInMemoryGoogleSession,
  requestGoogleAccessToken,
  type GoogleAccountProfile
} from "../../data/google/googleAuth";
import {
  createBluehourSpreadsheet,
  ensureBluehourSheetSchema,
  extractSpreadsheetId
} from "../../data/google/googleSheetsAdapter";
import { pushSnapshotToGoogleSheet } from "../../data/google/sheetSerialization";
import type { LocalMutation, MutableStoreName } from "../../data/local-db/localDb";
import { startFirstSalaryCycle } from "../../domain/forecasting/cycleCommands";
import { planRemoteSnapshotSync } from "../../data/sync/remoteSync";
import { toCsv } from "../../domain/imports/csv";
import { parseMoneyInput } from "../../domain/money";
import { createRecordMeta, touchRecord } from "../../domain/records";
import type { Account, AppSettings, BalanceSnapshot, BluehourSnapshot, ConflictRecord, SyncState } from "../../domain/types";
import { isActive } from "../../domain/types";
import { readProfileManifest } from "../../domain/profileManifest";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export function SettingsPage() {
  const {
    snapshot,
    asOfDate,
    deviceIdentity,
    loading,
    error,
    saveRecords,
    restoreProfileSnapshot,
    applyRemoteSync,
    deleteLiveDataAndRestart,
    isDemo,
    canUseGoogleSync
  } = useBluehourData();
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
          onApplyRemoteSync={applyRemoteSync}
          onPushed={() => setMessage("Snapshot exported to Google Sheet with RAW values.")}
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

      <DangerZonePanel
        isDemo={isDemo}
        onDeleteLiveData={async () => {
          await deleteLiveDataAndRestart();
        }}
      />

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
  onApplyRemoteSync,
  onPushed
}: {
  snapshot: BluehourSnapshot;
  deviceId?: string;
  canUseGoogleSync: boolean;
  onApplyRemoteSync: (args: {
    mutations: LocalMutation[];
    conflicts: ConflictRecord[];
    syncState: SyncState;
    clearOutbox: boolean;
  }) => Promise<void>;
  onPushed: () => void;
}) {
  const existing = snapshot.settings.find((setting) => setting.key === "googleConnection" && !setting.archivedAt);
  const manifest = readProfileManifest(snapshot.settings);
  const existingDriveValue = existing ? driveConnectionDescriptorFromSetting(existing) : null;
  const syncState = snapshot.syncState.find((state) => state.key === "google");
  const [spreadsheetInput, setSpreadsheetInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingLocalChanges = snapshot.outboxOperations.length;
  const openConflicts = snapshot.conflicts.filter((conflict) => conflict.status === "open").length;
  const savedDriveFiles = existingDriveValue ? driveVaultFilesFromDescriptor(existingDriveValue) : driveVaultFilesFromSyncState(syncState);
  const googleSession = getInMemoryGoogleSession();

  function driveDescriptorSetting(files: DriveVaultFiles, account: GoogleAccountProfile, remoteRevision: number, lastSuccessfulSyncAt?: string): AppSettings {
    if (!manifest) {
      throw new Error("Profile manifest is missing");
    }
    const descriptor = createDriveConnectionDescriptor(files, {
      profileId: manifest.profileId,
      googleSubject: account.sub,
      googleEmail: account.email,
      googleName: account.name,
      lastKnownRemoteRevision: remoteRevision,
      lastSuccessfulSyncAt
    });
    const existingSetting = snapshot.settings.find((setting) => setting.key === "googleConnection" && !setting.archivedAt);
    return existingSetting
      ? { ...touchRecord(existingSetting), valueJson: JSON.stringify(descriptor) }
      : {
          ...createRecordMeta("settings"),
          key: "googleConnection",
          valueJson: JSON.stringify(descriptor)
        };
  }

  function driveSyncState({
    files,
    account,
    remoteRevision,
    status: nextStatus,
    message,
    lastRemoteWriterDeviceId = syncState?.lastRemoteWriterDeviceId,
    lastSyncedAt
  }: {
    files: DriveVaultFiles;
    account: GoogleAccountProfile;
    remoteRevision: number;
    status: SyncState["status"];
    message: string;
    lastRemoteWriterDeviceId?: string;
    lastSyncedAt?: string;
  }): SyncState {
    return {
      key: "google",
      provider: "drive_appdata",
      status: nextStatus,
      driveManifestFileId: files.manifestFileId,
      driveSlotAFileId: files.slotAFileId,
      driveSlotBFileId: files.slotBFileId,
      googleSubject: account.sub,
      googleEmail: account.email,
      googleName: account.name,
      profileId: manifest?.profileId,
      remoteRevision,
      lastSyncedAt,
      lastRemoteWriterDeviceId,
      message
    };
  }

  async function connectOrSyncDriveVault() {
    setBusy(true);
    setStatus(null);
    try {
      if (!canUseGoogleSync) {
        throw new Error("Demonstration data cannot be synced with Google Drive");
      }
      if (!GOOGLE_CLIENT_ID) {
        throw new Error("Set VITE_GOOGLE_CLIENT_ID before syncing Google Drive");
      }
      const token = await requestGoogleAccessToken(GOOGLE_CLIENT_ID);
      const account = await fetchGoogleAccountProfile(token);
      const files = savedDriveFiles ?? (await ensureDriveVaultFiles(token));
      const remote = await readSnapshotFromDriveVault(files, token);
      const now = new Date().toISOString();

      if (!remote) {
        await pushSnapshotToDriveVault(files, snapshot, token, fetch, 1, 0);
        await onApplyRemoteSync({
          mutations: [{ storeName: "settings", record: driveDescriptorSetting(files, account, 1, now), outbox: false }],
          conflicts: [],
          syncState: driveSyncState({
            files,
            account,
            remoteRevision: 1,
            status: "synced",
            message: "Google Drive vault created and local profile pushed.",
            lastRemoteWriterDeviceId: deviceId,
            lastSyncedAt: now
          }),
          clearOutbox: true
        });
        setStatus("Google Drive vault created and local profile pushed.");
        return;
      }

      const plan = planRemoteSnapshotSync(snapshot, remote, {
        supportedSchemaVersion: DRIVE_VAULT_SCHEMA_VERSION,
        remoteLabel: "Google Drive vault"
      });
      const baseState = driveSyncState({
        files,
        account,
        remoteRevision: plan.remoteRevision,
        status: plan.syncState.status,
        message: plan.syncState.message ?? "Google Drive sync planned.",
        lastRemoteWriterDeviceId: remote.lastWrittenByDeviceId,
        lastSyncedAt: plan.syncState.lastSyncedAt
      });

      if (plan.action === "push_local") {
        await pushSnapshotToDriveVault(files, snapshot, token, fetch, plan.nextRemoteRevision, plan.remoteRevision);
        const syncedAt = new Date().toISOString();
        await onApplyRemoteSync({
          mutations: [{ storeName: "settings", record: driveDescriptorSetting(files, account, plan.nextRemoteRevision, syncedAt), outbox: false }],
          conflicts: [],
          syncState: driveSyncState({
            files,
            account,
            remoteRevision: plan.nextRemoteRevision,
            status: "synced",
            message: "Local outbox pushed to Google Drive vault.",
            lastRemoteWriterDeviceId: deviceId,
            lastSyncedAt: syncedAt
          }),
          clearOutbox: true
        });
        setStatus("Local outbox pushed to Google Drive vault.");
        return;
      }

      await onApplyRemoteSync({
        mutations: [...plan.mutations, { storeName: "settings", record: driveDescriptorSetting(files, account, plan.remoteRevision, baseState.lastSyncedAt), outbox: false }],
        conflicts: plan.conflicts,
        syncState: baseState,
        clearOutbox: plan.clearOutbox
      });
      setStatus(plan.syncState.message ?? "Google Drive sync complete.");
    } catch (caught) {
      setStatus(syncFailureMessage(caught, "Google Drive sync failed"));
    } finally {
      setBusy(false);
    }
  }

  async function checkDriveVault() {
    setBusy(true);
    setStatus(null);
    try {
      if (!canUseGoogleSync) {
        throw new Error("Demonstration data cannot check Google Drive");
      }
      if (!GOOGLE_CLIENT_ID) {
        throw new Error("Set VITE_GOOGLE_CLIENT_ID before checking Google Drive");
      }
      const token = await requestGoogleAccessToken(GOOGLE_CLIENT_ID);
      const files = savedDriveFiles ?? (await ensureDriveVaultFiles(token));
      const remote = await readSnapshotFromDriveVault(files, token);
      if (!remote) {
        setStatus("No Google Drive vault exists yet for this account. Sync now will create it.");
        return;
      }
      const plan = planRemoteSnapshotSync(snapshot, remote, {
        supportedSchemaVersion: DRIVE_VAULT_SCHEMA_VERSION,
        remoteLabel: "Google Drive vault"
      });
      const summary =
        plan.action === "no_op"
          ? "No remote changes."
          : plan.action === "apply_remote" && pendingLocalChanges > 0
            ? "Both browsers changed data. Sync now will pull remote changes first and keep local changes waiting."
            : plan.action === "apply_remote"
              ? "Remote changes available."
              : plan.action === "conflict"
                ? "Conflict review required."
                : plan.action === "cross_profile_blocked"
                  ? "Different remote profile ID. Automatic merge is blocked."
                  : plan.action === "read_only_recovery"
                    ? "Remote Drive vault requires read-only recovery."
                    : pendingLocalChanges > 0
                      ? "Local changes waiting."
                      : "Local profile should be pushed.";
      setStatus(`${summary} Remote revision ${remote.remoteRevision}.`);
    } catch (caught) {
      setStatus(syncFailureMessage(caught, "Google Drive check failed"));
    } finally {
      setBusy(false);
    }
  }

  function downloadDescriptor() {
    if (!existingDriveValue) {
      setStatus("Connect Google Drive before downloading a descriptor.");
      return;
    }
    downloadJson("bluehour-google-drive-vault-descriptor.json", existingDriveValue);
  }

  async function exportToSheet() {
    setBusy(true);
    setStatus(null);
    try {
      if (!canUseGoogleSync) {
        throw new Error("Demonstration data cannot be exported to Google Sheets");
      }
      if (!GOOGLE_CLIENT_ID) {
        throw new Error("Set VITE_GOOGLE_CLIENT_ID before exporting to Google Sheets");
      }
      const token = await requestGoogleAccessToken(GOOGLE_CLIENT_ID, { scopes: GOOGLE_SHEETS_SCOPES });
      const spreadsheetId = spreadsheetInput.trim() ? extractSpreadsheetId(spreadsheetInput) : await createBluehourSpreadsheet(token);
      await ensureBluehourSheetSchema(spreadsheetId, token);
      await pushSnapshotToGoogleSheet(spreadsheetId, snapshot, token);
      setSpreadsheetInput(spreadsheetId);
      setStatus("Snapshot exported to Google Sheets for inspection. Drive vault remains the sync source of truth.");
      onPushed();
    } catch (caught) {
      setStatus(syncFailureMessage(caught, "Google Sheet export failed"));
    } finally {
      setBusy(false);
    }
  }

  async function disconnectDevice() {
    if (!existing) {
      setStatus("This browser is not connected to a Google Drive vault.");
      return;
    }
    const setting: AppSettings = existing
      ? {
          ...touchRecord(existing),
          archivedAt: new Date().toISOString()
        }
      : {
          ...createRecordMeta("settings"),
          key: "googleConnection",
          valueJson: "{}",
          archivedAt: new Date().toISOString()
        };
    await onApplyRemoteSync({
      mutations: [{ storeName: "settings", record: setting, outbox: false }],
      conflicts: [],
      syncState: {
        key: "google",
        status: "saved_locally",
        message: pendingLocalChanges > 0 ? "Disconnected. Unsynchronised local changes remain only on this browser." : "Disconnected. Local data was preserved."
      },
      clearOutbox: false
    });
    clearInMemoryGoogleAccessToken();
    setStatus("This browser was disconnected. Local data and the remote Drive vault were preserved.");
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Google</p>
          <h2>Drive vault sync</h2>
        </div>
      </div>
      <div className="stack-list">
        {!canUseGoogleSync ? <p className="form-note danger-text">Google sync is disabled for the fictional demonstration profile.</p> : null}
        <p>
          Bluehour uses a hidden Google Drive app-data vault as the cross-browser source of truth. Tokens stay in memory only for this tab and
          expire after one hour; local changes auto-sync while the session is active.
        </p>
        <div className="sync-summary-grid">
          <div>
            <small>Google account</small>
            <strong>{syncState?.googleEmail ?? existingDriveValue?.googleEmail ?? "Not connected"}</strong>
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
            <small>Provider</small>
            <strong>{syncState?.provider ?? existingDriveValue?.provider ?? "Local only"}</strong>
          </div>
          <div>
            <small>Local status</small>
            <strong>{syncState?.status ?? "saved_locally"}</strong>
          </div>
          <div>
            <small>Remote revision</small>
            <strong>{syncState?.remoteRevision ?? existingDriveValue?.lastKnownRemoteRevision ?? 0}</strong>
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
            <small>Vault files</small>
            <strong>{savedDriveFiles ? "Remembered" : "Not connected"}</strong>
          </div>
          <div>
            <small>Session</small>
            <strong>{googleSession ? `Active until ${formatSessionExpiry(googleSession.expiresAt)}` : "Reconnect when syncing"}</strong>
          </div>
        </div>
        <div className="form-actions">
          <button className="primary-action" type="button" onClick={() => void connectOrSyncDriveVault()} disabled={busy || !canUseGoogleSync}>
            <RefreshCw size={16} aria-hidden="true" />
            Sync Drive vault
          </button>
          <button className="secondary-action" type="button" onClick={() => void checkDriveVault()} disabled={busy || !canUseGoogleSync}>
            Check vault
          </button>
          <button className="secondary-action" type="button" onClick={downloadDescriptor} disabled={!existingDriveValue || !canUseGoogleSync}>
            <Download size={16} aria-hidden="true" />
            Download vault descriptor
          </button>
          <button className="secondary-action danger-action" type="button" onClick={() => void disconnectDevice()} disabled={busy || !existing || !canUseGoogleSync}>
            <Unlink size={16} aria-hidden="true" />
            Disconnect this browser
          </button>
        </div>
        <div className="continue-device-card">
          <strong>Continue on another browser</strong>
          <p>Sync this browser, then open the same hosted Bluehour app elsewhere and choose Continue with Google using the same Google account.</p>
        </div>
        <div className="continue-device-card">
          <strong>Optional Google Sheet export</strong>
          <p>Sheets are now for inspection/export only. They are not the primary sync source.</p>
          <label>
            Existing Sheet URL or ID
            <input value={spreadsheetInput} onChange={(event) => setSpreadsheetInput(event.target.value)} />
          </label>
          <button className="secondary-action" type="button" onClick={() => void exportToSheet()} disabled={busy || !canUseGoogleSync}>
            <Upload size={16} aria-hidden="true" />
            {spreadsheetInput ? "Export to Sheet" : "Create Sheet export"}
          </button>
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

const DELETE_CONFIRMATION_TEXT = "DELETE LOCAL DATA";

function DangerZonePanel({ isDemo, onDeleteLiveData }: { isDemo: boolean; onDeleteLiveData: () => Promise<void> }) {
  const [confirmationText, setConfirmationText] = useState("");
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canDelete = !isDemo && backupConfirmed && confirmationText.trim() === DELETE_CONFIRMATION_TEXT;

  async function deleteLiveData() {
    setMessage(null);
    if (!canDelete) {
      setMessage(`Type ${DELETE_CONFIRMATION_TEXT} and confirm you understand the reset before deleting data.`);
      return;
    }

    setBusy(true);
    try {
      await onDeleteLiveData();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not delete local data");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Danger zone</p>
          <h2>Delete local data and restart</h2>
        </div>
      </div>
      <div className="stack-list">
        <p>
          This clears the live profile stored in this browser and restarts Bluehour at a blank live setup. It does not delete the hidden Google Drive
          vault or data stored in another browser.
        </p>
        {isDemo ? <p className="form-note danger-text">Switch to the live profile before deleting local live data. Demo reset is available in the top bar.</p> : null}
        <label>
          Type {DELETE_CONFIRMATION_TEXT}
          <input
            value={confirmationText}
            onChange={(event) => setConfirmationText(event.target.value)}
            disabled={busy || isDemo}
            aria-describedby="delete-local-data-warning"
          />
        </label>
        <p className="form-note danger-text" id="delete-local-data-warning">
          Export an encrypted backup first if you may need this browser's current data again.
        </p>
        <label className="checkbox-label">
          <input type="checkbox" checked={backupConfirmed} onChange={(event) => setBackupConfirmed(event.target.checked)} disabled={busy || isDemo} />
          I understand this deletes this browser's live profile and cannot be undone locally.
        </label>
        <div className="form-actions">
          <button className="secondary-action danger-action" type="button" onClick={() => void deleteLiveData()} disabled={busy || !canDelete}>
            <Trash2 size={16} aria-hidden="true" />
            Delete local data and restart
          </button>
        </div>
        {message ? <p className="form-note danger-text">{message}</p> : null}
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

function driveConnectionDescriptorFromSetting(setting: AppSettings): DriveConnectionDescriptor | null {
  try {
    return parseDriveConnectionDescriptor(JSON.parse(setting.valueJson));
  } catch {
    return null;
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

function formatSessionExpiry(expiresAt: number): string {
  return new Date(expiresAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
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
