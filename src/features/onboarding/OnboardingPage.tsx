import { CheckCircle2, Circle, Landmark, Plus } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { createStarterCategories } from "../../domain/categories/starterCategories";
import { formatDisplayDate } from "../../domain/dates";
import { startFirstSalaryCycle } from "../../domain/forecasting/cycleCommands";
import { parseMoneyInput } from "../../domain/money";
import { createRecordMeta, touchRecord } from "../../domain/records";
import type { Account, AppSettings, BalanceSnapshot } from "../../domain/types";
import { isActive } from "../../domain/types";

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
  const { snapshot, shellState, asOfDate, clock, loading, error, setOnboardingStep, saveRecords, enterLiveMode, returnToWelcome } =
    useBluehourData();
  const [message, setMessage] = useState<string | null>(null);
  const currentStep = shellState?.onboardingStep === "welcome" ? "google" : shellState?.onboardingStep ?? "google";
  const currentIndex = steps.findIndex((step) => step.id === currentStep);
  const accounts = useMemo(() => snapshot?.accounts.filter(isActive) ?? [], [snapshot]);
  const categories = useMemo(() => snapshot?.categories.filter((category) => isActive(category) && category.active) ?? [], [snapshot]);

  if (loading) {
    return <div className="loading-state full-page-state">Opening live setup...</div>;
  }

  if (error || !snapshot) {
    return (
      <main className="welcome-screen">
        <section className="empty-state">
          <h1>Set up my finances</h1>
          <p>{error ?? "Live setup is unavailable."}</p>
          <button className="secondary-action" type="button" onClick={() => void returnToWelcome()}>
            Return to welcome
          </button>
        </section>
      </main>
    );
  }

  async function savePreferencesAndCategories() {
    const now = clock.now();
    const existing = snapshot?.settings.find((setting) => setting.key === "preferences");
    const preferences: AppSettings = existing
      ? {
          ...touchRecord(existing),
          valueJson: JSON.stringify(defaultPreferences)
        }
      : {
          ...createRecordMeta("settings"),
          key: "preferences",
          valueJson: JSON.stringify(defaultPreferences)
        };
    const categoryMutations =
      categories.length === 0
        ? createStarterCategories(now).map((record) => ({ storeName: "categories" as const, record }))
        : [];

    await saveRecords([{ storeName: "settings", record: preferences }, ...categoryMutations], "onboarding preferences");
    await setOnboardingStep("accounts");
    setMessage("Preferences saved and starter categories are ready.");
  }

  async function markStepDone(nextStep: (typeof steps)[number]["id"]) {
    await setOnboardingStep(nextStep);
    setMessage(null);
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

        {currentStep === "google" ? (
          <SetupPanel
            title="Connect or defer Google"
            actionLabel="Defer Google for now"
            onNext={() => void markStepDone("preferences")}
          >
            <p>Live data can be entered locally before a private Google Sheet is connected. Tokens are requested only from Settings.</p>
          </SetupPanel>
        ) : null}

        {currentStep === "preferences" ? (
          <SetupPanel title="Preferences" actionLabel="Save defaults" onNext={() => void savePreferencesAndCategories()}>
            <dl className="summary-list">
              <div>
                <dt>Currency</dt>
                <dd>MYR</dd>
              </div>
              <div>
                <dt>Salary window</dt>
                <dd>24-26</dd>
              </div>
              <div>
                <dt>Protected target</dt>
                <dd>10%</dd>
              </div>
              <div>
                <dt>Buffer</dt>
                <dd>max(RM500, 10% of remaining essentials)</dd>
              </div>
            </dl>
          </SetupPanel>
        ) : null}

        {currentStep === "accounts" ? (
          <OnboardingAccountForm
            date={asOfDate}
            accounts={accounts}
            onSave={async (records) => {
              await saveRecords(
                [
                  { storeName: "accounts", record: records.account },
                  { storeName: "balanceSnapshots", record: records.balanceSnapshot }
                ],
                "onboarding account"
              );
              await setOnboardingStep("income");
              setMessage("Account saved without account numbers.");
            }}
          />
        ) : null}

        {currentStep === "income" ? (
          <SetupPanel title="Main and variable income" actionLabel="Continue" onNext={() => void markStepDone("obligations")}>
            <p>Enter the actual main salary only when it arrives. Confirmed and possible extra income can be added later from Plan.</p>
          </SetupPanel>
        ) : null}

        {currentStep === "obligations" ? (
          <SetupPanel title="Known obligations" actionLabel="Continue" onNext={() => void markStepDone("budget")}>
            <p>Add rent, utilities, subscriptions, debt repayments, and one-off commitments from Plan after setup.</p>
          </SetupPanel>
        ) : null}

        {currentStep === "budget" ? (
          <SetupPanel title="Guided first budget" actionLabel="Wait for salary" onNext={() => void markStepDone("wait_salary")}>
            <p>The first cycles are observational. Bluehour will not move budget or apply suggestions without approval.</p>
          </SetupPanel>
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
              await enterLiveMode();
            }}
          />
        ) : null}
      </section>
    </main>
  );
}

const defaultPreferences = {
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
  onSave
}: {
  date: string;
  accounts: Account[];
  incomeCategoryId: string;
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
          incomeCategoryId
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
