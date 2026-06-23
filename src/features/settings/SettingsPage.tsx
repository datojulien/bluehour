import { useState, type FormEvent } from "react";
import { Download, Plus, RefreshCw, Save, ShieldCheck, Trash2, Unlink, Upload } from "lucide-react";
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
  resetDriveVault,
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
import { isSystemCategory, moveCategory, validateCategoryConfiguration } from "../../domain/categories/categoryManagement";
import { startFirstSalaryCycle } from "../../domain/forecasting/cycleCommands";
import { planRemoteSnapshotSync } from "../../data/sync/remoteSync";
import { toCsv } from "../../domain/imports/csv";
import { parseMoneyInput } from "../../domain/money";
import { createRecordMeta, touchRecord } from "../../domain/records";
import {
  readSavingsCoachPreferences,
  savingsCoachPreferenceRecord,
  type SavingsCoachPreferences
} from "../../domain/coach/preferences";
import type { Account, AppSettings, BalanceSnapshot, BluehourSnapshot, Category, CoachInsightDecision, ConflictRecord, PlanInstance, RecurringRule, SyncState } from "../../domain/types";
import { isActive } from "../../domain/types";
import { readProfileManifest } from "../../domain/profileManifest";
import { inspectProfileHealth, type ProfileHealthResult } from "../../domain/profileHealth";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export function SettingsPage() {
  const {
    snapshot,
    shellState,
    asOfDate,
    deviceIdentity,
    loading,
    error,
    saveRecords,
    restoreProfileSnapshot,
    applyRemoteSync,
    deleteLiveDataAndRestart,
    resumeProfileAsLive,
    archiveAccidentalOpenCycleAndResumeOnboarding,
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
        <ProfileHealthPanel
          snapshot={snapshot}
          shellState={shellState}
          onResumeLive={async () => {
            await resumeProfileAsLive();
            setMessage("Profile Health repaired the manifest and resumed the live profile.");
          }}
          onArchiveCycle={async () => {
            await archiveAccidentalOpenCycleAndResumeOnboarding();
            setMessage("Profile Health archived the accidental first-cycle records and returned to setup.");
          }}
        />
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
          onPushed={() => setMessage("Optional Google Sheet export saved with RAW values.")}
          onVaultReset={() => setMessage("Hidden Google Drive vault reset. Local financial data was preserved.")}
        />
      </section>

      <CategoryManager
        categories={snapshot.categories}
        recurringRules={snapshot.recurringRules}
        planInstances={snapshot.planInstances}
        onSave={async (mutations) => {
          await saveRecords(mutations, "category management");
          setMessage("Category changes saved.");
        }}
      />

      <SavingsCoachSettingsPanel
        settings={snapshot.settings}
        categories={snapshot.categories}
        decisions={snapshot.coachInsightDecisions}
        onSave={async (preferences) => {
          await saveRecords([{ storeName: "settings", record: savingsCoachPreferenceRecord(snapshot.settings, preferences) }], "Savings Coach preferences");
          setMessage("Savings Coach preferences saved.");
        }}
        onResetDecisions={async (decisions) => {
          if (decisions.length === 0) {
            setMessage("No Savings Coach insight decisions to reset.");
            return;
          }
          await saveRecords(
            decisions.map((record) => ({ storeName: "coachInsightDecisions" as const, record })),
            "Savings Coach insight reset"
          );
          setMessage("Savings Coach insight decisions reset.");
        }}
      />

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

function SavingsCoachSettingsPanel({
  settings,
  categories,
  decisions,
  onSave,
  onResetDecisions
}: {
  settings: AppSettings[];
  categories: Category[];
  decisions: CoachInsightDecision[];
  onSave: (preferences: SavingsCoachPreferences) => Promise<void>;
  onResetDecisions: (decisions: CoachInsightDecision[]) => Promise<void>;
}) {
  const preferences = readSavingsCoachPreferences(settings);
  const [enabled, setEnabled] = useState(preferences.enabled);
  const [insightSensitivity, setInsightSensitivity] = useState(preferences.insightSensitivity);
  const [smallPurchaseThreshold, setSmallPurchaseThreshold] = useState((preferences.smallPurchaseThresholdMinor / 100).toFixed(2));
  const [smallPurchaseWindowDays, setSmallPurchaseWindowDays] = useState(String(preferences.smallPurchaseWindowDays));
  const [merchantWatchlist, setMerchantWatchlist] = useState(preferences.merchantWatchlist.join(", "));
  const [defaultGoalPriority, setDefaultGoalPriority] = useState(preferences.defaultGoalPriority);
  const [saveDifferenceDefault, setSaveDifferenceDefault] = useState(preferences.saveDifferenceDefault);
  const [snoozeDays, setSnoozeDays] = useState(String(preferences.snoozeDays));
  const [categoryTargets, setCategoryTargets] = useState<Record<string, string>>(
    Object.fromEntries(preferences.categoryReductionTargets.map((target) => [target.categoryId, String(target.targetReductionBasisPoints)]))
  );
  const [error, setError] = useState<string | null>(null);
  const targetCategories = categories
    .filter((category) => isActive(category) && category.active && category.nature === "discretionary")
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSave({
        enabled,
        insightSensitivity,
        smallPurchaseThresholdMinor: parseMoneyInput(smallPurchaseThreshold),
        smallPurchaseWindowDays: positiveInteger(smallPurchaseWindowDays, "small-purchase window"),
        merchantWatchlist: merchantWatchlist
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 20),
        categoryReductionTargets: Object.entries(categoryTargets)
          .map(([categoryId, value]) => ({
            categoryId,
            targetReductionBasisPoints: Number.parseInt(value, 10)
          }))
          .filter((target) => target.targetReductionBasisPoints > 0),
        defaultGoalPriority,
        saveDifferenceDefault,
        snoozeDays: positiveInteger(snoozeDays, "snooze days")
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Savings Coach preferences");
    }
  }

  async function resetDecisions() {
    const now = new Date().toISOString();
    await onResetDecisions(decisions.filter(isActive).map((decision) => ({ ...touchRecord(decision), archivedAt: now })));
  }

  return (
    <section className="dashboard-band" id="savings-coach">
      <div className="band-header">
        <div>
          <p className="eyebrow">Savings Coach</p>
          <h2>Preferences</h2>
        </div>
        <button className="secondary-action" type="button" onClick={() => void resetDecisions()}>
          Reset insights
        </button>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label className="checkbox-label">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Enabled
        </label>
        <label>
          Sensitivity
          <select value={insightSensitivity} onChange={(event) => setInsightSensitivity(event.target.value as SavingsCoachPreferences["insightSensitivity"])}>
            <option value="gentle">gentle</option>
            <option value="normal">normal</option>
            <option value="strict">strict</option>
          </select>
        </label>
        <label>
          Small purchase threshold
          <input value={smallPurchaseThreshold} onChange={(event) => setSmallPurchaseThreshold(event.target.value)} inputMode="decimal" />
        </label>
        <label>
          Watch window days
          <input value={smallPurchaseWindowDays} onChange={(event) => setSmallPurchaseWindowDays(event.target.value)} inputMode="numeric" />
        </label>
        <label>
          Goal priority
          <select value={defaultGoalPriority} onChange={(event) => setDefaultGoalPriority(event.target.value as SavingsCoachPreferences["defaultGoalPriority"])}>
            <option value="low">low</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
          </select>
        </label>
        <label>
          Save difference default
          <select value={saveDifferenceDefault} onChange={(event) => setSaveDifferenceDefault(event.target.value as SavingsCoachPreferences["saveDifferenceDefault"])}>
            <option value="ask">ask</option>
            <option value="move_half">move half</option>
            <option value="move_all">move all</option>
            <option value="keep_available">keep available</option>
          </select>
        </label>
        <label>
          Snooze days
          <input value={snoozeDays} onChange={(event) => setSnoozeDays(event.target.value)} inputMode="numeric" />
        </label>
        <label className="span-3">
          Merchant watchlist
          <input value={merchantWatchlist} onChange={(event) => setMerchantWatchlist(event.target.value)} />
        </label>
        <fieldset className="segmented-field span-3">
          <legend>Category reduction targets</legend>
          {targetCategories.map((category) => (
            <label key={category.id}>
              {category.name}
              <select
                value={categoryTargets[category.id] ?? "0"}
                onChange={(event) => setCategoryTargets((current) => ({ ...current, [category.id]: event.target.value }))}
              >
                <option value="0">off</option>
                <option value="500">5%</option>
                <option value="1000">10%</option>
                <option value="1500">15%</option>
                <option value="2000">20%</option>
              </select>
            </label>
          ))}
        </fieldset>
        {error ? <p className="form-error span-3">{error}</p> : null}
        <div className="form-actions span-3">
          <button className="primary-action" type="submit">
            <Save size={16} aria-hidden="true" />
            Save preferences
          </button>
        </div>
      </form>
    </section>
  );
}

function positiveInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${label} must be a positive whole number.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
}

function CategoryManager({
  categories,
  recurringRules,
  planInstances,
  onSave
}: {
  categories: Category[];
  recurringRules: RecurringRule[];
  planInstances: PlanInstance[];
  onSave: (mutations: LocalMutation[]) => Promise<void>;
}) {
  const sorted = [...categories].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));

  async function createCategory(record: Category) {
    await onSave([{ storeName: "categories", record }]);
  }

  async function saveCategory(category: Category) {
    const validation = validateCategoryConfiguration(category);
    if (!validation.valid) {
      throw new Error(validation.error ?? "Category configuration is invalid.");
    }
    await onSave([{ storeName: "categories", record: category }]);
  }

  async function reorder(categoryId: string, direction: "up" | "down") {
    const now = new Date().toISOString();
    const reordered = moveCategory(categories, categoryId, direction, now);
    const mutations = reordered
      .filter((category) => category.sortOrder !== categories.find((existing) => existing.id === category.id)?.sortOrder)
      .map((record) => ({ storeName: "categories" as const, record }));
    await onSave(mutations);
  }

  return (
    <section className="dashboard-band" id="categories">
      <div className="band-header">
        <div>
          <p className="eyebrow">Taxonomy</p>
          <h2>Category manager</h2>
        </div>
      </div>
      <div className="stack-list">
        <div className="stack-row">
          <span>
            <strong>Reservation modes</strong>
            <small>
              plan reserves dated obligations, envelope reserves salary-cycle allocations, protected reserves transfers to protected accounts, and none is for administrative records.
            </small>
          </span>
        </div>
      </div>
      <CategoryCreateForm onCreate={createCategory} />
      <div className="data-table category-table" role="region" aria-label="Categories">
        <div className="data-row header">
          <span>Category</span>
          <span>Group</span>
          <span>Nature</span>
          <span>Mode</span>
          <span>Status</span>
          <span>Order</span>
          <span>Action</span>
        </div>
        {sorted.map((category) => (
          <CategoryManagerRow
            key={category.id}
            category={category}
            categories={sorted}
            recurringRules={recurringRules}
            planInstances={planInstances}
            onSave={saveCategory}
            onReorder={reorder}
            onBulkSave={onSave}
          />
        ))}
      </div>
    </section>
  );
}

function CategoryCreateForm({ onCreate }: { onCreate: (category: Category) => Promise<void> }) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState<Category["group"]>("discretionary");
  const [nature, setNature] = useState<Category["nature"]>("discretionary");
  const [reservationMode, setReservationMode] = useState<Category["reservationMode"]>("envelope");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const category: Category = {
        ...createRecordMeta("cat"),
        name: name.trim(),
        group,
        nature,
        reservationMode,
        sortOrder: Date.now(),
        active: true
      };
      const validation = validateCategoryConfiguration(category);
      if (!validation.valid) {
        throw new Error(validation.error ?? "Category configuration is invalid.");
      }
      await onCreate(category);
      setName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create category");
    }
  }

  return (
    <form className="form-grid dashboard-subsection" onSubmit={submit}>
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <CategoryGroupSelect value={group} onChange={setGroup} />
      <CategoryNatureSelect value={nature} onChange={setNature} />
      <ReservationModeSelect value={reservationMode} onChange={setReservationMode} />
      {error ? <p className="form-error span-3">{error}</p> : null}
      <div className="form-actions span-3">
        <button className="primary-action" type="submit">
          <Plus size={16} aria-hidden="true" />
          Create category
        </button>
      </div>
    </form>
  );
}

function CategoryManagerRow({
  category,
  categories,
  recurringRules,
  planInstances,
  onSave,
  onReorder,
  onBulkSave
}: {
  category: Category;
  categories: Category[];
  recurringRules: RecurringRule[];
  planInstances: PlanInstance[];
  onSave: (category: Category) => Promise<void>;
  onReorder: (categoryId: string, direction: "up" | "down") => Promise<void>;
  onBulkSave: (mutations: LocalMutation[]) => Promise<void>;
}) {
  const [name, setName] = useState(category.name);
  const [group, setGroup] = useState(category.group);
  const [nature, setNature] = useState(category.nature);
  const [reservationMode, setReservationMode] = useState(category.reservationMode);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiveAffected, setArchiveAffected] = useState(false);
  const [reassignCategoryId, setReassignCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const system = isSystemCategory(category.id);
  const activeAffectedRules = recurringRules.filter((rule) => isActive(rule) && rule.active && rule.categoryId === category.id);
  const activeAffectedPlans = planInstances.filter((plan) => isActive(plan) && plan.status === "scheduled" && plan.categoryId === category.id);
  const affectedCount = activeAffectedRules.length + activeAffectedPlans.length;
  const validation = validateCategoryConfiguration({ group, nature, reservationMode });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (!validation.valid) {
        throw new Error(validation.error ?? "Category configuration is invalid.");
      }
      await onSave({
        ...touchRecord(category),
        name: name.trim(),
        group,
        nature,
        reservationMode
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save category");
    }
  }

  async function archiveOrRestore() {
    setError(null);
    try {
      const now = new Date().toISOString();
      if (isActive(category)) {
        if (system) {
          throw new Error("System categories cannot be archived.");
        }
        if (!confirmArchive) {
          throw new Error("Confirm archive before hiding this category.");
        }
        if (affectedCount > 0 && !archiveAffected && !reassignCategoryId) {
          throw new Error("Choose whether to archive or reassign active future rules and plans.");
        }
        const mutations: LocalMutation[] = [
          { storeName: "categories", record: { ...touchRecord(category), active: false, archivedAt: now } }
        ];
        if (archiveAffected) {
          activeAffectedRules.forEach((rule) => mutations.push({ storeName: "recurringRules", record: { ...touchRecord(rule), active: false } }));
          activeAffectedPlans.forEach((plan) => mutations.push({ storeName: "planInstances", record: { ...touchRecord(plan), status: "archived", archivedAt: now } }));
        } else if (reassignCategoryId) {
          activeAffectedRules.forEach((rule) => mutations.push({ storeName: "recurringRules", record: { ...touchRecord(rule), categoryId: reassignCategoryId } }));
          activeAffectedPlans.forEach((plan) => mutations.push({ storeName: "planInstances", record: { ...touchRecord(plan), categoryId: reassignCategoryId } }));
        }
        await onBulkSave(mutations);
        return;
      }

      await onSave({ ...touchRecord(category), active: true, archivedAt: null });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update archive state");
    }
  }

  return (
    <form className="data-row" onSubmit={submit}>
      <span>
        <input value={name} onChange={(event) => setName(event.target.value)} aria-label={`${category.name} name`} />
        <small>{category.id}</small>
      </span>
      <CategoryGroupSelect value={group} onChange={setGroup} disabled={system} />
      <CategoryNatureSelect value={nature} onChange={setNature} disabled={system} />
      <ReservationModeSelect value={reservationMode} onChange={setReservationMode} disabled={system} />
      <span>
        {isActive(category) ? "active" : "archived"}
        {validation.warning ? <small>{validation.warning}</small> : null}
      </span>
      <span className="inline-actions">
        <button className="secondary-action" type="button" onClick={() => void onReorder(category.id, "up")}>
          Move up
        </button>
        <button className="secondary-action" type="button" onClick={() => void onReorder(category.id, "down")}>
          Move down
        </button>
      </span>
      <span className="category-actions">
        <button className="icon-button" type="submit" aria-label={`Save ${category.name}`}>
          <Save size={15} aria-hidden="true" />
        </button>
        {!system ? (
          <>
            <label className="checkbox-label compact">
              <input type="checkbox" checked={confirmArchive} onChange={(event) => setConfirmArchive(event.target.checked)} />
              Confirm
            </label>
            <label className="checkbox-label compact">
              <input type="checkbox" checked={archiveAffected} onChange={(event) => setArchiveAffected(event.target.checked)} />
              Archive future
            </label>
            <select value={reassignCategoryId} onChange={(event) => setReassignCategoryId(event.target.value)} aria-label={`Reassign ${category.name} future records`}>
              <option value="">No reassignment</option>
              {categories
                .filter((candidate) => candidate.id !== category.id && isActive(candidate))
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
            </select>
            <button className="secondary-action" type="button" onClick={() => void archiveOrRestore()}>
              {isActive(category) ? "Archive" : "Restore"}
            </button>
          </>
        ) : null}
        {affectedCount > 0 ? <small>{affectedCount} active future reference{affectedCount === 1 ? "" : "s"}</small> : null}
        {error ? <small className="form-error">{error}</small> : null}
      </span>
    </form>
  );
}

function CategoryGroupSelect({ value, onChange, disabled = false }: { value: Category["group"]; onChange: (value: Category["group"]) => void; disabled?: boolean }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as Category["group"])} disabled={disabled} aria-label="Category group">
      <option value="committed">committed</option>
      <option value="essential_flexible">essential flexible</option>
      <option value="discretionary">discretionary</option>
      <option value="protected">protected</option>
      <option value="administrative">administrative</option>
    </select>
  );
}

function CategoryNatureSelect({ value, onChange, disabled = false }: { value: Category["nature"]; onChange: (value: Category["nature"]) => void; disabled?: boolean }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as Category["nature"])} disabled={disabled} aria-label="Category nature">
      <option value="essential">essential</option>
      <option value="discretionary">discretionary</option>
      <option value="protected">protected</option>
      <option value="administrative">administrative</option>
    </select>
  );
}

function ReservationModeSelect({ value, onChange, disabled = false }: { value: Category["reservationMode"]; onChange: (value: Category["reservationMode"]) => void; disabled?: boolean }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as Category["reservationMode"])} disabled={disabled} aria-label="Reservation mode">
      <option value="plan">plan</option>
      <option value="envelope">envelope</option>
      <option value="protected">protected</option>
      <option value="none">none</option>
    </select>
  );
}

function ProfileHealthPanel({
  snapshot,
  shellState,
  onResumeLive,
  onArchiveCycle
}: {
  snapshot: BluehourSnapshot;
  shellState: ReturnType<typeof useBluehourData>["shellState"];
  onResumeLive: () => Promise<void>;
  onArchiveCycle: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const manifest = safeReadManifest(snapshot.settings);
  const health = inspectProfileHealth({
    snapshot,
    manifest,
    shell: shellState
      ? {
          applicationState: shellState.applicationState,
          onboardingStep: shellState.onboardingStep
        }
      : null
  });
  const syncState = snapshot.syncState.find((state) => state.key === "google");

  async function run(label: string, action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage(label);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Profile Health action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-band" id="profile-health">
      <div className="band-header">
        <div>
          <p className="eyebrow">Profile Health</p>
          <h2>Local profile {health.status === "healthy" ? "healthy" : "needs repair"}</h2>
        </div>
      </div>
      <div className="sync-summary-grid">
        <HealthMetric label="Manifest lifecycle" value={health.manifestLifecycle} />
        <HealthMetric label="Onboarding step" value={health.onboardingStep ?? "none"} />
        <HealthMetric label="Open salary cycles" value={String(health.openCycleCount)} />
        <HealthMetric label="Closed salary cycles" value={String(health.closedCycleCount)} />
        <HealthMetric label="Remote vault" value={syncState?.provider === "drive_appdata" ? syncState.status : "not connected"} />
        <HealthMetric label="Remote revision" value={String(syncState?.remoteRevision ?? 0)} />
        <HealthMetric label="Pending local changes" value={String(snapshot.outboxOperations.length)} />
        <HealthMetric label="Shell state" value={shellState?.applicationState ?? "none"} />
      </div>
      <div className="stack-list">
        {health.issues.length === 0 ? <p>No local profile-health issues were detected.</p> : null}
        {health.issues.map((issue) => (
          <div className={`health-issue health-issue-${issue.severity}`} key={issue.id}>
            <strong>{issue.title}</strong>
            {issue.explanation.map((line) => (
              <small key={line}>{line}</small>
            ))}
          </div>
        ))}
        <div className="form-actions">
          <button className="primary-action" type="button" onClick={() => void run("Profile resumed as live.", onResumeLive)} disabled={busy || !health.canResumeAsLive}>
            Resume as live profile
          </button>
        </div>
        <div className="continue-device-card">
          <strong>Archive accidental cycle</strong>
          <p>Available only when Bluehour can identify the first-cycle records safely. Records are archived, not permanently deleted.</p>
          <label className="checkbox-label">
            <input type="checkbox" checked={confirmArchive} onChange={(event) => setConfirmArchive(event.target.checked)} disabled={busy || !health.canArchiveAccidentalCycle} />
            I understand this archives the accidental first-cycle records.
          </label>
          <button
            className="secondary-action"
            type="button"
            onClick={() => void run("Accidental salary cycle archived.", onArchiveCycle)}
            disabled={busy || !health.canArchiveAccidentalCycle || !confirmArchive}
          >
            Archive accidental cycle
          </button>
        </div>
        <details>
          <summary>Advanced diagnostics</summary>
          <pre>{JSON.stringify(profileHealthDiagnostic(health, snapshot), null, 2)}</pre>
        </details>
        {message ? <p className="form-note">{message}</p> : null}
      </div>
    </section>
  );
}

function HealthMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function profileHealthDiagnostic(health: ProfileHealthResult, snapshot: BluehourSnapshot) {
  return {
    status: health.status,
    issues: health.issues.map((issue) => issue.id),
    manifestLifecycle: health.manifestLifecycle,
    onboardingStep: health.onboardingStep,
    openCycleCount: health.openCycleCount,
    closedCycleCount: health.closedCycleCount,
    pendingLocalChanges: snapshot.outboxOperations.length
  };
}

function GoogleSettings({
  snapshot,
  deviceId,
  canUseGoogleSync,
  onApplyRemoteSync,
  onPushed,
  onVaultReset
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
  onVaultReset: () => void;
}) {
  const existing = snapshot.settings.find((setting) => setting.key === "googleConnection" && !setting.archivedAt);
  const manifest = readProfileManifest(snapshot.settings);
  const existingDriveValue = existing ? driveConnectionDescriptorFromSetting(existing) : null;
  const syncState = snapshot.syncState.find((state) => state.key === "google");
  const [spreadsheetInput, setSpreadsheetInput] = useState("");
  const [vaultResetText, setVaultResetText] = useState("");
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

  async function resetHiddenDriveVault() {
    setBusy(true);
    setStatus(null);
    try {
      if (!canUseGoogleSync) {
        throw new Error("Demonstration data cannot reset a Google Drive vault");
      }
      if (vaultResetText.trim() !== "RESET GOOGLE VAULT") {
        throw new Error("Type RESET GOOGLE VAULT before resetting the hidden Google Drive vault.");
      }
      if (!GOOGLE_CLIENT_ID) {
        throw new Error("Set VITE_GOOGLE_CLIENT_ID before resetting the Google Drive vault");
      }
      const token = await requestGoogleAccessToken(GOOGLE_CLIENT_ID);
      const files = savedDriveFiles ?? (await ensureDriveVaultFiles(token));
      const expectedRemoteRevision = syncState?.remoteRevision ?? existingDriveValue?.lastKnownRemoteRevision;
      await resetDriveVault(files, token, fetch, expectedRemoteRevision);
      const archivedConnection = existing
        ? {
            ...touchRecord(existing),
            archivedAt: new Date().toISOString()
          }
        : null;
      await onApplyRemoteSync({
        mutations: archivedConnection ? [{ storeName: "settings", record: archivedConnection, outbox: false }] : [],
        conflicts: [],
        syncState: {
          key: "google",
          status: "saved_locally",
          message: "Hidden Google Drive vault reset. Local financial data and pending local changes were preserved."
        },
        clearOutbox: false
      });
      clearInMemoryGoogleAccessToken();
      setVaultResetText("");
      setStatus("Hidden Google Drive vault reset. Reconnect Google to create a new vault from this local profile.");
      onVaultReset();
    } catch (caught) {
      setStatus(syncFailureMessage(caught, "Google Drive vault reset failed"));
    } finally {
      setBusy(false);
    }
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
        <div className="continue-device-card">
          <strong>Reset hidden Google Drive vault</strong>
          <p>
            Bluehour stores sync data in hidden Google Drive app data, not in Google Sheets. Resetting the Drive vault removes the remote sync copy
            for this Google account. It does not delete local data on this browser unless you also reset local data.
          </p>
          <p className="form-note danger-text">Export an encrypted backup first. Optional Sheet export is only for inspection and is not the sync source.</p>
          <label>
            Type RESET GOOGLE VAULT
            <input value={vaultResetText} onChange={(event) => setVaultResetText(event.target.value)} disabled={busy || !canUseGoogleSync} />
          </label>
          <button
            className="secondary-action danger-action"
            type="button"
            onClick={() => void resetHiddenDriveVault()}
            disabled={busy || !canUseGoogleSync || vaultResetText.trim() !== "RESET GOOGLE VAULT"}
          >
            <Trash2 size={16} aria-hidden="true" />
            Reset hidden Google Drive vault
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
          This clears only this browser's local live profile and restarts Bluehour at a blank live setup. If Google Drive vault sync is still
          connected, reconnecting may restore the remote profile. To start completely fresh, reset the hidden Google Drive vault too.
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

function safeReadManifest(settings: readonly AppSettings[]) {
  try {
    return readProfileManifest(settings);
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
