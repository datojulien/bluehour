import { CheckCircle2, Circle, KeyRound, Landmark, Plus } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { clearInMemoryGoogleAccessToken, requestGoogleAccessToken } from "../../data/google/googleAuth";
import { createBluehourSpreadsheet, createConnectionDescriptor, ensureBluehourSheetSchema, parseConnectionDescriptor } from "../../data/google/googleSheetsAdapter";
import { pushSnapshotToGoogleSheet } from "../../data/google/sheetSerialization";
import { createStarterCategories } from "../../domain/categories/starterCategories";
import { formatDisplayDate } from "../../domain/dates";
import { startFirstSalaryCycle } from "../../domain/forecasting/cycleCommands";
import { parseMoneyInput } from "../../domain/money";
import { createRecordMeta, touchRecord } from "../../domain/records";
import type { Account, AppSettings, BalanceSnapshot, BudgetAllocation, Category, PlanInstance } from "../../domain/types";
import { isActive } from "../../domain/types";
import { readProfileManifest } from "../../domain/profileManifest";
import { BudgetCoachPanel } from "../budgets/BudgetCoachPanel";
import {
  appendBudgetCoachDecision,
  budgetCoachPreferenceRecord,
  onboardingBudgetCoachInput,
  readBudgetCoachPreferences,
  recommendedProfileForOnboarding
} from "../budgets/budgetCoachSettings";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

const steps = [
  { id: "google", label: "Google" },
  { id: "preferences", label: "Preferences" },
  { id: "accounts", label: "Accounts" },
  { id: "income", label: "Income" },
  { id: "obligations", label: "Obligations" },
  { id: "budget", label: "Budget" },
  { id: "wait_salary", label: "Wait salary" },
  { id: "start_cycle", label: "Start cycle" }
] as const;

export function OnboardingPage() {
  const { snapshot, shellState, asOfDate, clock, loading, error, setOnboardingStep, saveRecords, saveRecordsAndAdvanceOnboarding, markSynced, returnToWelcome } =
    useBluehourData();
  const [message, setMessage] = useState<string | null>(null);
  const currentStep = shellState?.onboardingStep === "welcome" ? "google" : shellState?.onboardingStep ?? "google";
  const currentIndex = steps.findIndex((step) => step.id === currentStep);
  const accounts = useMemo(() => snapshot?.accounts.filter(isActive) ?? [], [snapshot]);
  const categories = useMemo(() => snapshot?.categories.filter((category) => isActive(category) && category.active) ?? [], [snapshot]);
  const budgetCoachPreferences = useMemo(() => {
    const stored = readBudgetCoachPreferences(snapshot?.settings ?? [], categories);
    return snapshot ? recommendedProfileForOnboarding(snapshot, asOfDate, stored) : stored;
  }, [asOfDate, categories, snapshot]);

  if (loading) {
    return <div className="loading-state full-page-state">Opening live setup...</div>;
  }

  if (error || !snapshot) {
    return (
      <main className="welcome-screen">
        <section className="empty-state">
          <h1>Set up new finances</h1>
          <p>{error ?? "Live setup is unavailable."}</p>
          <button className="secondary-action" type="button" onClick={() => void returnToWelcome()}>
            Return to welcome
          </button>
        </section>
      </main>
    );
  }

  async function savePreferencesAndCategories(preferencesInput: PreferencesSettings) {
    const now = clock.now();
    const existing = snapshot?.settings.find((setting) => setting.key === "preferences");
    const preferences: AppSettings = existing
      ? {
          ...touchRecord(existing),
          valueJson: JSON.stringify(preferencesInput)
        }
      : {
          ...createRecordMeta("settings"),
          key: "preferences",
          valueJson: JSON.stringify(preferencesInput)
        };
    const categoryMutations =
      categories.length === 0
        ? createStarterCategories(now).map((record) => ({ storeName: "categories" as const, record }))
        : [];

    await saveRecordsAndAdvanceOnboarding([{ storeName: "settings", record: preferences }, ...categoryMutations], "accounts", "setup", "onboarding preferences");
    setMessage("Preferences saved and starter categories are ready.");
  }

  async function markStepDone(nextStep: (typeof steps)[number]["id"]) {
    await setOnboardingStep(nextStep);
    setMessage(null);
  }

  async function connectGoogleFromOnboarding() {
    if (!GOOGLE_CLIENT_ID) {
      throw new Error("Restart the Vite dev server after adding VITE_GOOGLE_CLIENT_ID to .env");
    }

    try {
      const token = await requestGoogleAccessToken(GOOGLE_CLIENT_ID);
      const spreadsheetId = await createBluehourSpreadsheet(token);
      const manifest = snapshot ? readProfileManifest(snapshot.settings) : null;
      if (!manifest) {
        throw new Error("Profile manifest is not ready yet");
      }
      const descriptor = createConnectionDescriptor(spreadsheetId, { profileId: manifest.profileId });
      const existing = snapshot?.settings.find((setting) => setting.key === "googleConnection");
      const setting: AppSettings = existing
        ? { ...touchRecord(existing), valueJson: JSON.stringify(descriptor) }
        : {
            ...createRecordMeta("settings"),
            key: "googleConnection",
            valueJson: JSON.stringify(descriptor)
          };

      await saveRecordsAndAdvanceOnboarding([{ storeName: "settings", record: setting }], "preferences", "setup", "Google connection");
      setMessage("Google Sheet created. Use Save progress to Google when you want this setup available on another device.");
    } finally {
      clearInMemoryGoogleAccessToken();
    }
  }

  async function saveProgressToGoogle() {
    if (!snapshot) {
      throw new Error("Bluehour data has not loaded yet");
    }
    if (!GOOGLE_CLIENT_ID) {
      throw new Error("Set VITE_GOOGLE_CLIENT_ID before syncing Google Sheets");
    }
    const connection = snapshot.settings.find((setting) => setting.key === "googleConnection" && !setting.archivedAt);
    if (!connection) {
      throw new Error("Connect Google before saving progress to the Sheet");
    }
    const descriptor = parseConnectionDescriptor(JSON.parse(connection.valueJson));
    const token = await requestGoogleAccessToken(GOOGLE_CLIENT_ID);
    try {
      const expectedRemoteRevision = snapshot.syncState.find((state) => state.key === "google")?.remoteRevision ?? descriptor.lastKnownRemoteRevision;
      const nextRemoteRevision = expectedRemoteRevision + 1;
      await ensureBluehourSheetSchema(descriptor.spreadsheetId, token);
      await pushSnapshotToGoogleSheet(descriptor.spreadsheetId, snapshot, token, fetch, nextRemoteRevision, expectedRemoteRevision);
      await markSynced({
        key: "google",
        status: "synced",
        spreadsheetId: descriptor.spreadsheetId,
        profileId: descriptor.profileId,
        remoteRevision: nextRemoteRevision,
        lastSyncedAt: new Date().toISOString(),
        message: "Saved to Google. This progress is available on your other devices."
      });
      setMessage("Saved to Google. This progress is available on your other devices.");
    } finally {
      clearInMemoryGoogleAccessToken();
    }
  }

  return (
    <main className="onboarding-screen">
      <section className="onboarding-rail" aria-label="Setup progress">
        <div className="brand-block compact">
          <div className="brand-mark" aria-hidden="true">
            B
          </div>
          <div>
            <div className="brand-name">Bluehour</div>
            <div className="brand-state">Live setup</div>
          </div>
        </div>
        <ol className="step-list">
          {steps.map((step, index) => (
            <li key={step.id} className={index <= currentIndex ? "active" : ""}>
              {index < currentIndex ? <CheckCircle2 size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
              <button type="button" onClick={() => void setOnboardingStep(step.id)}>
                {step.label}
              </button>
            </li>
          ))}
        </ol>
        <button className="secondary-action" type="button" onClick={() => void returnToWelcome()}>
          Return to welcome
        </button>
      </section>

      <section className="onboarding-panel">
        <div className="page-header">
          <div>
            <p className="eyebrow">Step {Math.max(currentIndex + 1, 1)} of 8</p>
            <h1>{steps[Math.max(currentIndex, 0)]?.label ?? "Setup"}</h1>
          </div>
          <div className="date-chip">Today {formatDisplayDate(asOfDate)}</div>
        </div>

        {message ? <div className="alert-band">{message}</div> : null}

        <OnboardingCheckpointStatus snapshot={snapshot} onSaveProgress={() => void saveProgressToGoogle()} onEnableRecovery={() => void setOnboardingStep("google")} />

        {currentStep === "google" ? (
          <GoogleOnboardingPanel
            hasClientId={Boolean(GOOGLE_CLIENT_ID)}
            onConnect={connectGoogleFromOnboarding}
            onDefer={() => void markStepDone("preferences")}
          />
        ) : null}

        {currentStep === "preferences" ? (
          <PreferencesForm initialPreferences={preferencesFromSettings(snapshot.settings)} onSave={(preferences) => void savePreferencesAndCategories(preferences)} />
        ) : null}

        {currentStep === "accounts" ? (
          <OnboardingAccountForm
            date={asOfDate}
            accounts={accounts}
            onSave={async (records) => {
              await saveRecordsAndAdvanceOnboarding(
                [
                  { storeName: "accounts", record: records.account },
                  { storeName: "balanceSnapshots", record: records.balanceSnapshot }
                ],
                "income",
                "setup",
                "onboarding account"
              );
              setMessage("Account saved without account numbers.");
            }}
          />
        ) : null}

        {currentStep === "income" ? (
          <IncomeSetupForm
            date={asOfDate}
            incomeCategoryId={categories.find((category) => category.id === "cat-income")?.id ?? "cat-income"}
            onSkip={() => void markStepDone("obligations")}
            onSave={async (plan) => {
              await saveRecordsAndAdvanceOnboarding([{ storeName: "planInstances", record: plan }], "obligations", "setup", "onboarding income");
              setMessage("Income plan saved.");
            }}
          />
        ) : null}

        {currentStep === "obligations" ? (
          <ObligationSetupForm
            date={asOfDate}
            categories={categories}
            onSkip={() => void markStepDone("budget")}
            onSave={async (plan) => {
              await saveRecordsAndAdvanceOnboarding([{ storeName: "planInstances", record: plan }], "budget", "setup", "onboarding obligation");
              setMessage("Obligation saved.");
            }}
          />
        ) : null}

        {currentStep === "budget" ? (
          <BudgetCoachPanel
            title="Guided first salary-cycle budget"
            input={onboardingBudgetCoachInput(snapshot, asOfDate, budgetCoachPreferences)}
            categories={categories}
            preferences={budgetCoachPreferences}
            canApply
            applyLabel="Accept suggested budget"
            onReturnToIncome={() => void setOnboardingStep("income")}
            onReturnToObligations={() => void setOnboardingStep("obligations")}
            onPreferencesChange={async (preferences) => {
              await saveRecords(
                [{ storeName: "settings", record: budgetCoachPreferenceRecord(snapshot.settings, categories, preferences) }],
                "Budget Coach preferences"
              );
              setMessage("Budget Coach preferences saved.");
            }}
            onAcceptAll={async (result, preferences) => {
              const acceptedPreferences = appendBudgetCoachDecision({
                preferences,
                result,
                appliedCategoryIds: result.categoryRecommendations.map((recommendation) => recommendation.categoryId)
              });
              const template = budgetTemplateSettingFromRecommendation(
                result.categoryRecommendations,
                snapshot.settings.find((setting) => setting.key === "onboardingBudgetTemplate")
              );
              await saveRecordsAndAdvanceOnboarding(
                [
                  { storeName: "settings", record: budgetCoachPreferenceRecord(snapshot.settings, categories, acceptedPreferences) },
                  { storeName: "settings", record: template }
                ],
                "wait_salary",
                "setup",
                "onboarding budget coach"
              );
              setMessage("Budget Coach saved the accepted first-cycle template.");
            }}
          />
        ) : null}

        {currentStep === "wait_salary" ? (
          <SetupPanel
            title="Wait for next salary"
            actionLabel="Salary has arrived"
            onNext={() => void setOnboardingStep("start_cycle", "ready_for_salary")}
          >
            <p>History starts with the next main salary. When it arrives, enter the actual deposit and current account balance.</p>
          </SetupPanel>
        ) : null}

        {currentStep === "start_cycle" ? (
          <FirstCycleForm
            date={asOfDate}
            accounts={accounts}
            incomeCategoryId={categories.find((category) => category.id === "cat-income")?.id ?? "cat-income"}
            existingCycles={snapshot.budgetCycles}
            onSave={async (records) => {
              const firstCycleAllocations = allocationsFromBudgetTemplate(records.cycle.id, snapshot.settings);
              const archivedDestinationSetupSnapshots = snapshot.balanceSnapshots
                .filter((record) => isActive(record) && record.accountId === records.openingSnapshot.accountId)
                .map((record) => ({
                  ...touchRecord(record),
                  archivedAt: clock.now(),
                  note: record.note ? `${record.note} Archived when the first salary boundary was created.` : "Archived when the first salary boundary was created."
                }));
              await saveRecordsAndAdvanceOnboarding(
                [
                  ...archivedDestinationSetupSnapshots.map((record) => ({ storeName: "balanceSnapshots" as const, record })),
                  { storeName: "balanceSnapshots", record: records.openingSnapshot },
                  { storeName: "transactions", record: records.salaryTransaction },
                  { storeName: "transactionLegs", record: records.salaryLeg },
                  { storeName: "transactionSplits", record: records.salarySplit },
                  { storeName: "budgetCycles", record: records.cycle },
                  ...firstCycleAllocations.map((record) => ({ storeName: "budgetAllocations" as const, record }))
                ],
                "start_cycle",
                "live",
                "first salary cycle"
              );
            }}
          />
        ) : null}
      </section>
    </main>
  );
}

function GoogleOnboardingPanel({
  hasClientId,
  onConnect,
  onDefer
}: {
  hasClientId: boolean;
  onConnect: () => Promise<void>;
  onDefer: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setStatus(null);
    try {
      await onConnect();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Google connection failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Live profile</p>
          <h2>Connect or defer Google</h2>
        </div>
      </div>
      <div className="stack-list">
        <p>Bluehour can create a private app-managed Sheet now, or you can keep working locally and connect later in Settings.</p>
        {!hasClientId ? (
          <p className="form-note danger-text">No Google client ID is available in this running Vite session. Add it to `.env`, then restart `npm run dev`.</p>
        ) : null}
        <div className="form-actions">
          <button className="primary-action" type="button" onClick={() => void connect()} disabled={busy || !hasClientId}>
            <KeyRound size={16} aria-hidden="true" />
            Connect Google
          </button>
          <button className="secondary-action" type="button" onClick={onDefer} disabled={busy}>
            Defer Google for now
          </button>
        </div>
        {status ? <p className="form-note danger-text">{status}</p> : null}
      </div>
    </section>
  );
}

function OnboardingCheckpointStatus({
  snapshot,
  onSaveProgress,
  onEnableRecovery
}: {
  snapshot: NonNullable<ReturnType<typeof useBluehourData>["snapshot"]>;
  onSaveProgress: () => void;
  onEnableRecovery: () => void;
}) {
  const syncState = snapshot.syncState.find((state) => state.key === "google");
  const connection = snapshot.settings.find((setting) => setting.key === "googleConnection" && !setting.archivedAt);
  const pendingChanges = snapshot.outboxOperations.length;
  const statusText =
    syncState?.status === "synced"
      ? "Saved to Google. Available on your other devices."
      : connection
        ? pendingChanges > 0
          ? `${pendingChanges} changes waiting to sync.`
          : "Saved on this device. Reconnect Google to make this progress available elsewhere."
        : "Saved on this device only.";

  return (
    <section className="checkpoint-strip" aria-label="Cross-device recovery status">
      <div>
        <strong>{statusText}</strong>
        <small>
          {connection
            ? "Use the same hosted Bluehour app and a Google account with access to this Sheet on the other device."
            : "Enable cross-device recovery before expecting another device to continue this setup."}
        </small>
      </div>
      {connection ? (
        <button className="secondary-action" type="button" onClick={onSaveProgress}>
          Save progress to Google
        </button>
      ) : (
        <button className="secondary-action" type="button" onClick={onEnableRecovery}>
          Enable cross-device recovery
        </button>
      )}
    </section>
  );
}

const defaultPreferences: PreferencesSettings = {
  currency: "MYR",
  locale: "en-MY",
  dateDisplay: "DD/MM/YYYY",
  amountDisplay: "RM1,234.50",
  salaryWindowStartDay: 24,
  salaryWindowEndDay: 26,
  minimumProtectedRateBasisPoints: 1_000,
  bufferMinimumMinor: 50_000,
  bufferEssentialRateBasisPoints: 1_000,
  weeklyReconciliationDefault: true
};

interface PreferencesSettings {
  currency: "MYR";
  locale: string;
  dateDisplay: string;
  amountDisplay: string;
  salaryWindowStartDay: number;
  salaryWindowEndDay: number;
  minimumProtectedRateBasisPoints: number;
  bufferMinimumMinor: number;
  bufferEssentialRateBasisPoints: number;
  weeklyReconciliationDefault: boolean;
}

interface BudgetTemplate {
  allocations: Array<{ categoryId: string; amountMinor: number }>;
}

function PreferencesForm({
  initialPreferences,
  onSave
}: {
  initialPreferences: PreferencesSettings;
  onSave: (preferences: PreferencesSettings) => void;
}) {
  const [salaryWindowStartDay, setSalaryWindowStartDay] = useState(String(initialPreferences.salaryWindowStartDay));
  const [salaryWindowEndDay, setSalaryWindowEndDay] = useState(String(initialPreferences.salaryWindowEndDay));
  const [protectedRatePercent, setProtectedRatePercent] = useState(String(initialPreferences.minimumProtectedRateBasisPoints / 100));
  const [bufferMinimum, setBufferMinimum] = useState((initialPreferences.bufferMinimumMinor / 100).toFixed(2));
  const [bufferEssentialPercent, setBufferEssentialPercent] = useState(String(initialPreferences.bufferEssentialRateBasisPoints / 100));
  const [weeklyReconciliationDefault, setWeeklyReconciliationDefault] = useState(initialPreferences.weeklyReconciliationDefault);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const startDay = parseWholeNumber(salaryWindowStartDay, "Salary window start");
      const endDay = parseWholeNumber(salaryWindowEndDay, "Salary window end");
      if (startDay < 1 || startDay > 31 || endDay < startDay || endDay > 31) {
        throw new Error("Salary window must be valid calendar days");
      }

      onSave({
        ...initialPreferences,
        salaryWindowStartDay: startDay,
        salaryWindowEndDay: endDay,
        minimumProtectedRateBasisPoints: percentTextToBasisPoints(protectedRatePercent),
        bufferMinimumMinor: parseMoneyInput(bufferMinimum),
        bufferEssentialRateBasisPoints: percentTextToBasisPoints(bufferEssentialPercent),
        weeklyReconciliationDefault
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save preferences");
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Live profile</p>
          <h2>Preferences</h2>
        </div>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label>
          Salary window start day
          <input inputMode="numeric" value={salaryWindowStartDay} onChange={(event) => setSalaryWindowStartDay(event.target.value)} required />
        </label>
        <label>
          Salary window end day
          <input inputMode="numeric" value={salaryWindowEndDay} onChange={(event) => setSalaryWindowEndDay(event.target.value)} required />
        </label>
        <label>
          Protected target %
          <input inputMode="decimal" value={protectedRatePercent} onChange={(event) => setProtectedRatePercent(event.target.value)} required />
        </label>
        <label>
          Minimum buffer
          <input inputMode="decimal" value={bufferMinimum} onChange={(event) => setBufferMinimum(event.target.value)} required />
        </label>
        <label>
          Essential buffer %
          <input inputMode="decimal" value={bufferEssentialPercent} onChange={(event) => setBufferEssentialPercent(event.target.value)} required />
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={weeklyReconciliationDefault} onChange={(event) => setWeeklyReconciliationDefault(event.target.checked)} />
          Weekly reconciliation by default
        </label>
        {error ? <p className="form-error span-3">{error}</p> : null}
        <div className="form-actions span-3">
          <button className="primary-action" type="submit">
            Save preferences
          </button>
        </div>
      </form>
    </section>
  );
}

function IncomeSetupForm({
  date,
  incomeCategoryId,
  onSave,
  onSkip
}: {
  date: string;
  incomeCategoryId: string;
  onSave: (plan: PlanInstance) => Promise<void>;
  onSkip: () => void;
}) {
  const [name, setName] = useState("Main salary estimate");
  const [expectedDate, setExpectedDate] = useState(date);
  const [amount, setAmount] = useState("");
  const [confidence, setConfidence] = useState<PlanInstance["confidence"]>("confirmed");
  const [isMainSalaryEstimate, setIsMainSalaryEstimate] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const amountMinor = parseMoneyInput(amount);
      if (amountMinor <= 0) {
        throw new Error("Income amount must be greater than RM0.00");
      }

      await onSave({
        ...createRecordMeta("plan"),
        kind: "income",
        name,
        expectedDate: expectedDate as PlanInstance["expectedDate"],
        expectedAmountMinor: amountMinor,
        confidence,
        reservation: "informational",
        status: "scheduled",
        categoryId: incomeCategoryId,
        isMainSalaryEstimate
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save income");
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Live profile</p>
          <h2>Main and variable income</h2>
        </div>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label className="span-2">
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Expected date
          <input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} required />
        </label>
        <label>
          Amount
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label>
          Confidence
          <select value={confidence} onChange={(event) => setConfidence(event.target.value as PlanInstance["confidence"])}>
            <option value="confirmed">confirmed</option>
            <option value="expected">expected</option>
            <option value="possible">possible</option>
          </select>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={isMainSalaryEstimate} onChange={(event) => setIsMainSalaryEstimate(event.target.checked)} />
          Treat as main salary estimate
        </label>
        {error ? <p className="form-error span-3">{error}</p> : null}
        <div className="form-actions span-3">
          <button className="secondary-action" type="button" onClick={onSkip}>
            Skip for now
          </button>
          <button className="primary-action" type="submit">
            Save income
          </button>
        </div>
      </form>
    </section>
  );
}

function ObligationSetupForm({
  date,
  categories,
  onSave,
  onSkip
}: {
  date: string;
  categories: Category[];
  onSave: (plan: PlanInstance) => Promise<void>;
  onSkip: () => void;
}) {
  const reservableCategories = categories.filter((category) => category.nature !== "administrative" && category.nature !== "protected");
  const [name, setName] = useState("Rent or fixed bill");
  const [expectedDate, setExpectedDate] = useState(date);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState(reservableCategories[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const category = categories.find((item) => item.id === categoryId);
      const amountMinor = parseMoneyInput(amount);
      if (!category) {
        throw new Error("Choose an obligation category");
      }
      if (amountMinor <= 0) {
        throw new Error("Obligation amount must be greater than RM0.00");
      }

      await onSave({
        ...createRecordMeta("plan"),
        kind: "expense",
        name,
        expectedDate: expectedDate as PlanInstance["expectedDate"],
        expectedAmountMinor: amountMinor,
        confidence: "expected",
        reservation: "reserved",
        status: "scheduled",
        categoryId,
        essential: category.nature === "essential"
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save obligation");
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Live profile</p>
          <h2>Known obligations</h2>
        </div>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label className="span-2">
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Due date
          <input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} required />
        </label>
        <label>
          Amount
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label className="span-2">
          Category
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            {reservableCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        {error ? <p className="form-error span-3">{error}</p> : null}
        <div className="form-actions span-3">
          <button className="secondary-action" type="button" onClick={onSkip}>
            Skip for now
          </button>
          <button className="primary-action" type="submit">
            Save obligation
          </button>
        </div>
      </form>
    </section>
  );
}

function SetupPanel({
  title,
  actionLabel,
  onNext,
  children
}: {
  title: string;
  actionLabel: string;
  onNext: () => void;
  children: ReactNode;
}) {
  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Live profile</p>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="stack-list">{children}</div>
      <div className="form-actions">
        <button className="primary-action" type="button" onClick={onNext}>
          {actionLabel}
        </button>
      </div>
    </section>
  );
}

function OnboardingAccountForm({
  date,
  accounts,
  onSave
}: {
  date: string;
  accounts: Account[];
  onSave: (records: { account: Account; balanceSnapshot: BalanceSnapshot }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<Account["type"]>("bank");
  const [role, setRole] = useState<Account["role"]>("spendable");
  const [openingBalance, setOpeningBalance] = useState("");
  const [institutionLabel, setInstitutionLabel] = useState("");
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
        trackingMode: ["investment", "property", "vehicle", "loan"].includes(type) ? "manual_snapshot" : "ledger",
        currency: "MYR",
        institutionLabel: institutionLabel || undefined,
        reconcileWeekly: role === "spendable",
        sortOrder: Date.now()
      };
      const balanceSnapshot: BalanceSnapshot = {
        ...createRecordMeta("bal"),
        accountId: account.id,
        asOfDate: date as BalanceSnapshot["asOfDate"],
        amountMinor: parseMoneyInput(openingBalance),
        source: account.trackingMode === "ledger" ? "opening" : "manual_valuation"
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
          <h2>Add first account</h2>
        </div>
        <span className="date-chip">{accounts.length} saved</span>
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
          Opening value
          <input value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} inputMode="decimal" required />
        </label>
        <label className="span-2">
          Institution label
          <input value={institutionLabel} onChange={(event) => setInstitutionLabel(event.target.value)} />
        </label>
        {error ? <p className="form-error span-3">{error}</p> : null}
        <div className="form-actions span-3">
          <button className="primary-action" type="submit">
            <Plus size={16} aria-hidden="true" />
            Save and continue
          </button>
        </div>
      </form>
    </section>
  );
}

function FirstCycleForm({
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
      if (!destinationAccountId) {
        throw new Error("Add a destination account before starting the first cycle");
      }

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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start salary cycle");
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Salary boundary</p>
          <h2>Start first salary cycle</h2>
        </div>
        <Landmark size={20} aria-hidden="true" />
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
            Start live profile
          </button>
        </div>
      </form>
    </section>
  );
}

function preferencesFromSettings(settings: readonly AppSettings[]): PreferencesSettings {
  const setting = settings.find((item) => item.key === "preferences");
  if (!setting) {
    return defaultPreferences;
  }

  try {
    return { ...defaultPreferences, ...(JSON.parse(setting.valueJson) as Partial<PreferencesSettings>) };
  } catch {
    return defaultPreferences;
  }
}

function budgetTemplateFromSettings(settings: readonly AppSettings[]): BudgetTemplate {
  const setting = settings.find((item) => item.key === "onboardingBudgetTemplate");
  if (!setting) {
    return { allocations: [] };
  }

  try {
    const parsed = JSON.parse(setting.valueJson) as BudgetTemplate;
    return Array.isArray(parsed.allocations) ? parsed : { allocations: [] };
  } catch {
    return { allocations: [] };
  }
}

function budgetTemplateSettingFromRecommendation(
  recommendations: readonly { categoryId: string; suggestedAmountMinor: number }[],
  existingSetting?: AppSettings
): AppSettings {
  const allocations = recommendations
    .filter((recommendation) => recommendation.suggestedAmountMinor > 0)
    .map((recommendation) => ({
      categoryId: recommendation.categoryId,
      amountMinor: recommendation.suggestedAmountMinor
    }));
  const valueJson = JSON.stringify({ allocations } satisfies BudgetTemplate);

  return existingSetting
    ? {
        ...touchRecord(existingSetting),
        valueJson
      }
    : {
        ...createRecordMeta("settings"),
        key: "onboardingBudgetTemplate",
        valueJson
      };
}

function allocationsFromBudgetTemplate(cycleId: string, settings: readonly AppSettings[]): BudgetAllocation[] {
  return budgetTemplateFromSettings(settings).allocations.map((allocation) => ({
    ...createRecordMeta("alloc"),
    budgetCycleId: cycleId,
    categoryId: allocation.categoryId,
    baseAmountMinor: allocation.amountMinor,
    note: "Created from onboarding budget template."
  }));
}

function parseWholeNumber(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be a whole number`);
  }
  return parsed;
}

function percentTextToBasisPoints(value: string): number {
  const trimmed = value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new Error("Percentage must be zero or greater");
  }

  const whole = Number.parseInt(match[1] ?? "0", 10);
  const fraction = match[2] ?? "";
  const paddedFraction = fraction.padEnd(3, "0");
  const firstTwoDigits = Number.parseInt(paddedFraction.slice(0, 2), 10);
  const roundingDigit = Number.parseInt(paddedFraction.slice(2, 3), 10);
  return whole * 100 + firstTwoDigits + (roundingDigit >= 5 ? 1 : 0);
}
