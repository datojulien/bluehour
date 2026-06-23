import { useMemo, useState, type FormEvent } from "react";
import { Archive, BellOff, CalendarPlus, CheckCircle2, PiggyBank, Save, ShieldCheck, WalletCards } from "lucide-react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { addDays, formatDisplayDate } from "../../domain/dates";
import { parseMoneyInput } from "../../domain/money";
import { createRecordMeta, touchRecord } from "../../domain/records";
import { buildDashboardModel } from "../dashboard/dashboardModel";
import type { CoachInsightDecision, PlanInstance, PurchaseCheck, RecurringRule, SavingsGoal, SavingsGoalContribution, Subscription } from "../../domain/types";
import { isActive } from "../../domain/types";
import { Amount } from "../../ui/Amount";
import { readSavingsCoachPreferences } from "../../domain/coach/preferences";
import { evaluatePurchaseCheck, purchaseCheckRecord, type PurchaseCheckInput, type PurchaseCheckResult } from "../../domain/coach/purchaseCheck";
import { createSaveDifferenceContribution, detectSaveDifferenceOpportunities, saveDifferenceAmount } from "../../domain/coach/saveDifference";
import { buildSavingsCycleReview } from "../../domain/coach/savingsCycleReview";
import { buildSavingsGoalProgress, createSavingsGoal, savingsGoalContribution } from "../../domain/coach/savingsGoals";
import { detectSpendingLeaks, type SpendingInsight } from "../../domain/coach/spendingLeakDetector";
import { subscriptionCostSummary } from "../../domain/subscriptions/subscriptionCost";
import type { LocalMutation } from "../../data/local-db/localDb";

interface CheckedPurchase {
  input: PurchaseCheckInput;
  result: PurchaseCheckResult;
  record: PurchaseCheck;
}

type SubscriptionReviewStatus = "active" | "paused";

export function CoachPage() {
  const { snapshot, asOfDate, loading, error, saveRecord, saveRecords, saveTransaction } = useBluehourData();
  const [message, setMessage] = useState<string | null>(null);
  const [purchase, setPurchase] = useState<CheckedPurchase | null>(null);
  const [goalForDifference, setGoalForDifference] = useState("");

  const activeCycle = snapshot?.budgetCycles.find((cycle) => isActive(cycle) && cycle.status === "open");
  const preferences = useMemo(() => (snapshot ? readSavingsCoachPreferences(snapshot.settings) : null), [snapshot]);
  const model = useMemo(() => (snapshot ? buildDashboardModel(snapshot, asOfDate) : null), [snapshot, asOfDate]);
  const insights = useMemo(
    () => (snapshot && activeCycle && preferences ? detectSpendingLeaks(snapshot, activeCycle, asOfDate, preferences) : []),
    [activeCycle, asOfDate, preferences, snapshot]
  );
  const goalProgress = useMemo(
    () => (snapshot && activeCycle ? buildSavingsGoalProgress(snapshot.savingsGoals, snapshot.savingsGoalContributions, asOfDate, activeCycle) : []),
    [activeCycle, asOfDate, snapshot]
  );
  const activeGoals = goalProgress.filter((progress) => progress.goal.status === "active");
  const selectedGoalId = activeGoals.some((progress) => progress.goal.id === goalForDifference) ? goalForDifference : activeGoals[0]?.goal.id || "";
  const saveDifference = useMemo(
    () =>
      snapshot && activeCycle
        ? detectSaveDifferenceOpportunities(snapshot, activeCycle, asOfDate, model?.periods.untilSalary.available.safeToSpendMinor)
        : [],
    [activeCycle, asOfDate, model, snapshot]
  );
  const review = useMemo(
    () => (snapshot && activeCycle && preferences ? buildSavingsCycleReview(snapshot, activeCycle, asOfDate, preferences) : null),
    [activeCycle, asOfDate, preferences, snapshot]
  );

  if (loading) {
    return <div className="loading-state">Opening Savings Coach...</div>;
  }

  if (error || !snapshot || !activeCycle || !preferences || !model || !review) {
    return (
      <section className="empty-state">
        <h1>Savings Coach</h1>
        <p>{error ?? "No open salary cycle is available for Savings Coach."}</p>
      </section>
    );
  }

  const loadedSnapshot = snapshot;
  const cycle = activeCycle;
  const coachPreferences = preferences;
  const spendableAccount = loadedSnapshot.accounts.find((account) => isActive(account) && account.role === "spendable");
  const activeCategories = loadedSnapshot.categories.filter((category) => isActive(category) && category.active && category.nature !== "administrative");
  const optionalSubscriptions = loadedSnapshot.subscriptions
    .filter((subscription) => isActive(subscription) && (subscription.status ?? "active") !== "archived")
    .sort((left, right) => left.nextPaymentDate.localeCompare(right.nextPaymentDate) || left.provider.localeCompare(right.provider));
  const potentialSavingsMinor =
    insights.reduce((total, insight) => total + insight.potentialSavingMinor, 0) +
    saveDifference.reduce((total, opportunity) => total + opportunity.suggestedMoveMinor, 0);

  async function decideInsight(insight: SpendingInsight, decision: CoachInsightDecision["decision"]) {
    const decisionRecord: CoachInsightDecision = {
      ...createRecordMeta("coach-decision"),
      insightFingerprint: insight.fingerprint,
      decision,
      decidedAt: new Date().toISOString(),
      snoozedUntil: decision === "snoozed" ? addDays(asOfDate, coachPreferences.snoozeDays) : undefined
    };
    await saveRecord("coachInsightDecisions", decisionRecord, "Savings Coach insight decision");
    setMessage(decision === "snoozed" ? "Insight snoozed." : "Insight decision saved.");
  }

  async function convertInsightToGoal(insight: SpendingInsight) {
    const goal = createSavingsGoal({
      name: `Reduce ${insight.title}`,
      targetMinor: Math.max(1_000, insight.potentialSavingMinor),
      priority: coachPreferences.defaultGoalPriority
    });
    const decisionRecord: CoachInsightDecision = {
      ...createRecordMeta("coach-decision"),
      insightFingerprint: insight.fingerprint,
      decision: "converted_to_goal",
      decidedAt: new Date().toISOString(),
      linkedSavingsGoalId: goal.id
    };
    await saveRecords(
      [
        { storeName: "savingsGoals", record: goal },
        { storeName: "coachInsightDecisions", record: decisionRecord }
      ],
      "Savings Coach goal conversion"
    );
    setMessage("Savings goal created from the insight.");
  }

  async function convertInsightToPlan(insight: SpendingInsight) {
    const plan: PlanInstance = {
      ...createRecordMeta("plan"),
      kind: "expense",
      name: insight.title,
      expectedDate: addDays(asOfDate, 7),
      expectedAmountMinor: insight.potentialSavingMinor,
      confidence: "expected",
      reservation: "informational",
      status: "scheduled",
      categoryId: insight.categoryId
    };
    const decisionRecord: CoachInsightDecision = {
      ...createRecordMeta("coach-decision"),
      insightFingerprint: insight.fingerprint,
      decision: "converted_to_plan",
      decidedAt: new Date().toISOString(),
      linkedPlanInstanceId: plan.id
    };
    await saveRecords(
      [
        { storeName: "planInstances", record: plan },
        { storeName: "coachInsightDecisions", record: decisionRecord }
      ],
      "Savings Coach plan conversion"
    );
    setMessage("Planned item created from the insight.");
  }

  async function savePurchaseDecision(decision: PurchaseCheck["decision"], links: Partial<Pick<PurchaseCheck, "linkedTransactionId" | "linkedPlanInstanceId">> = {}) {
    if (!purchase) {
      return;
    }
    const record: PurchaseCheck = {
      ...touchRecord(purchase.record),
      decision,
      linkedTransactionId: links.linkedTransactionId ?? purchase.record.linkedTransactionId,
      linkedPlanInstanceId: links.linkedPlanInstanceId ?? purchase.record.linkedPlanInstanceId
    };
    await saveRecord("purchaseChecks", record, "purchase check decision");
    setPurchase({ ...purchase, record });
  }

  async function buyCheckedPurchase() {
    if (!purchase || !spendableAccount) {
      return;
    }
    const result = await saveTransaction({
      type: "expense",
      occurredOn: purchase.input.intendedDate,
      description: purchase.input.label,
      amountMinor: purchase.input.amountMinor,
      accountId: spendableAccount.id,
      categoryId: purchase.input.categoryId,
      source: "manual"
    });
    await savePurchaseDecision("bought", { linkedTransactionId: result.transaction.id });
    setMessage("Purchase saved as a transaction.");
  }

  async function planCheckedPurchase() {
    if (!purchase || !spendableAccount) {
      return;
    }
    const plan: PlanInstance = {
      ...createRecordMeta("plan"),
      kind: "expense",
      name: purchase.input.label,
      expectedDate: purchase.input.intendedDate,
      expectedAmountMinor: purchase.input.amountMinor,
      confidence: "expected",
      reservation: "reserved",
      status: "scheduled",
      categoryId: purchase.input.categoryId,
      accountId: spendableAccount.id
    };
    const record: PurchaseCheck = {
      ...touchRecord(purchase.record),
      decision: "planned",
      linkedPlanInstanceId: plan.id
    };
    await saveRecords(
      [
        { storeName: "planInstances", record: plan },
        { storeName: "purchaseChecks", record }
      ],
      "purchase plan"
    );
    setPurchase({ ...purchase, record });
    setMessage("Purchase saved as a planned item.");
  }

  async function createGoalFromPurchase() {
    if (!purchase) {
      return;
    }
    const goal = createSavingsGoal({
      name: purchase.input.label,
      targetMinor: purchase.input.amountMinor,
      priority: coachPreferences.defaultGoalPriority
    });
    await saveRecord("savingsGoals", goal, "purchase savings goal");
    setMessage("Savings goal created from the purchase check.");
  }

  async function saveDifferenceContribution(opportunityIndex: number, mode: "half" | "all") {
    const goalId = selectedGoalId;
    const opportunity = saveDifference[opportunityIndex];
    if (!goalId || !opportunity) {
      return;
    }
    const amountMinor = saveDifferenceAmount(opportunity, mode);
    const contribution = createSaveDifferenceContribution({
      goalId,
      opportunity,
      amountMinor,
      occurredOn: asOfDate,
      budgetCycleId: cycle.id
    });
    await saveRecord("savingsGoalContributions", contribution, "Save-the-Difference contribution");
    setMessage("Pending savings contribution saved. Create or link the bank transfer when you move the money.");
  }

  async function updateGoalStatus(goal: SavingsGoal, status: SavingsGoal["status"]) {
    await saveRecord("savingsGoals", { ...touchRecord(goal), status }, "savings goal status");
    setMessage("Savings goal updated.");
  }

  async function addManualContribution(contribution: SavingsGoalContribution) {
    await saveRecord("savingsGoalContributions", contribution, "savings goal contribution");
    setMessage("Manual savings contribution saved.");
  }

  async function updateSubscriptionValue(subscription: Subscription, valueRating: NonNullable<Subscription["valueRating"]>, status: SubscriptionReviewStatus) {
    const subscriptionRecord: Subscription = {
      ...touchRecord(subscription),
      valueRating,
      status,
      lastReviewedOn: asOfDate
    };
    const mutations: LocalMutation[] = [{ storeName: "subscriptions", record: subscriptionRecord }];
    const rule = loadedSnapshot.recurringRules.find((item): item is RecurringRule => item.id === subscription.recurringRuleId && isActive(item));
    if (rule) {
      mutations.push({ storeName: "recurringRules", record: { ...touchRecord(rule), active: status === "active" } });
    }
    await saveRecords(mutations, "subscription value review");
    setMessage("Subscription review saved.");
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Savings Coach</p>
          <h1>Coach</h1>
        </div>
        <div className="date-chip">{formatDisplayDate(asOfDate)}</div>
      </div>

      {message ? <section className="alert-band">{message}</section> : null}

      <section className="metric-grid" aria-label="Savings Coach summary">
        <SummaryMetric icon={<PiggyBank size={18} />} label="Potential this cycle" value={potentialSavingsMinor} />
        <SummaryMetric icon={<ShieldCheck size={18} />} label="Protected remaining" value={review.remainingProtectedMinor} />
        <SummaryMetric icon={<WalletCards size={18} />} label="Goal gap" value={review.goalRemainingMinor} />
        <SummaryMetric icon={<BellOff size={18} />} label="Coach insights" text={`${insights.length}`} />
      </section>

      <section className="two-column">
        <section className="dashboard-band" id="leaks">
          <div className="band-header">
            <div>
              <p className="eyebrow">Spending Leak Detector</p>
              <h2>Current watchlist</h2>
            </div>
          </div>
          {insights.length > 0 ? (
            <div className="stack-list">
              {insights.map((insight) => (
                <div className="coach-card" key={insight.fingerprint}>
                  <div>
                    <strong>{insight.title}</strong>
                    <small>
                      {insight.description} Potential: <Amount value={insight.potentialSavingMinor} />.
                    </small>
                  </div>
                  <div className="inline-actions">
                    <button className="secondary-action" type="button" onClick={() => void decideInsight(insight, "dismissed")}>
                      Dismiss
                    </button>
                    <button className="secondary-action" type="button" onClick={() => void decideInsight(insight, "snoozed")}>
                      Snooze
                    </button>
                    <button className="secondary-action" type="button" onClick={() => void convertInsightToGoal(insight)}>
                      Goal
                    </button>
                    <button className="secondary-action" type="button" onClick={() => void convertInsightToPlan(insight)}>
                      Plan
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p>No active coach insights for this cycle.</p>
          )}
        </section>

        <section className="dashboard-band" id="purchase">
          <div className="band-header">
            <div>
              <p className="eyebrow">Can I Buy This?</p>
              <h2>Purchase check</h2>
            </div>
          </div>
          <PurchaseCheckForm
            categories={activeCategories}
            defaultDate={asOfDate}
            onCheck={async (input) => {
              const result = evaluatePurchaseCheck(loadedSnapshot, cycle, asOfDate, input);
              const record = purchaseCheckRecord(input, result);
              await saveRecord("purchaseChecks", record, "purchase check");
              setPurchase({ input, result, record });
              setMessage("Purchase check saved.");
            }}
          />
          {purchase ? (
            <div className={`coach-result coach-result-${purchase.result.result}`}>
              <strong>{resultLabel(purchase.result.result)}</strong>
              <span>
                Safe-to-spend changes from <Amount value={purchase.result.safeToSpendBeforeMinor} /> to{" "}
                <Amount value={purchase.result.safeToSpendAfterMinor} />.
              </span>
              <ul>
                {purchase.result.explanations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="inline-actions">
                <button className="primary-action" type="button" onClick={() => void buyCheckedPurchase()} disabled={!spendableAccount}>
                  <Save size={16} aria-hidden="true" />
                  Buy
                </button>
                <button className="secondary-action" type="button" onClick={() => void planCheckedPurchase()} disabled={!spendableAccount}>
                  <CalendarPlus size={16} aria-hidden="true" />
                  Plan
                </button>
                <button className="secondary-action" type="button" onClick={() => void createGoalFromPurchase()}>
                  <PiggyBank size={16} aria-hidden="true" />
                  Goal
                </button>
                <button className="secondary-action" type="button" onClick={() => void savePurchaseDecision("waited")}>
                  Wait
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </section>

      <section className="dashboard-band" id="goals">
        <div className="band-header">
          <div>
            <p className="eyebrow">Savings Goals</p>
            <h2>Goal progress</h2>
          </div>
        </div>
        <SavingsGoalForm
          defaultPriority={coachPreferences.defaultGoalPriority}
          onSave={async (goal) => {
            await saveRecord("savingsGoals", goal, "savings goal");
            setMessage("Savings goal saved.");
          }}
        />
        <div className="coach-grid">
          {goalProgress.map((progress) => (
            <div className="coach-card" key={progress.goal.id}>
              <div>
                <strong>{progress.goal.name}</strong>
                <small>
                  {progress.percentageComplete}% complete · Remaining <Amount value={progress.remainingMinor} /> · Per cycle{" "}
                  <Amount value={progress.requiredPerCycleMinor} />
                </small>
              </div>
              <div className="progress-track" role="progressbar" aria-label={`${progress.goal.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percentageComplete}>
                <span style={{ width: `${Math.min(100, progress.percentageComplete)}%` }} />
              </div>
              <ManualContributionForm
                goal={progress.goal}
                date={asOfDate}
                cycleId={cycle.id}
                onSave={(contribution) => addManualContribution(contribution)}
              />
              <div className="inline-actions">
                <button className="secondary-action" type="button" onClick={() => void updateGoalStatus(progress.goal, "active")}>
                  Active
                </button>
                <button className="secondary-action" type="button" onClick={() => void updateGoalStatus(progress.goal, "paused")}>
                  Pause
                </button>
                <button className="secondary-action" type="button" onClick={() => void updateGoalStatus(progress.goal, "completed")}>
                  Complete
                </button>
                <button className="secondary-action" type="button" onClick={() => void saveRecord("savingsGoals", { ...touchRecord(progress.goal), archivedAt: new Date().toISOString() }, "savings goal archive")}>
                  <Archive size={14} aria-hidden="true" />
                  Archive
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="two-column">
        <section className="dashboard-band" id="difference">
          <div className="band-header">
            <div>
              <p className="eyebrow">Save-the-Difference</p>
              <h2>Underspent envelopes</h2>
            </div>
          </div>
          {activeGoals.length > 0 ? (
            <label className="coach-select-label">
              Goal
              <select value={selectedGoalId} onChange={(event) => setGoalForDifference(event.target.value)}>
                {activeGoals.map((progress) => (
                  <option key={progress.goal.id} value={progress.goal.id}>
                    {progress.goal.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>Create an active savings goal before saving the difference.</p>
          )}
          <div className="stack-list">
            {saveDifference.map((opportunity, index) => (
              <div className="stack-row" key={opportunity.categoryId}>
                <div>
                  <strong>{opportunity.categoryName}</strong>
                  <small>
                    Remaining <Amount value={opportunity.remainingMinor} /> · Suggested <Amount value={opportunity.suggestedMoveMinor} />
                  </small>
                </div>
                <div className="inline-actions">
                  <button className="secondary-action" type="button" disabled={!selectedGoalId} onClick={() => void saveDifferenceContribution(index, "half")}>
                    Half
                  </button>
                  <button className="secondary-action" type="button" disabled={!selectedGoalId} onClick={() => void saveDifferenceContribution(index, "all")}>
                    All
                  </button>
                </div>
              </div>
            ))}
            {saveDifference.length === 0 ? <p>No Save-the-Difference opportunities are currently available.</p> : null}
          </div>
        </section>

        <section className="dashboard-band" id="subscriptions">
          <div className="band-header">
            <div>
              <p className="eyebrow">Subscription Optimiser</p>
              <h2>Review value</h2>
            </div>
          </div>
          <div className="stack-list">
            {optionalSubscriptions.map((subscription) => {
              const rule = loadedSnapshot.recurringRules.find((item) => item.id === subscription.recurringRuleId && isActive(item));
              const cost = rule ? subscriptionCostSummary(rule.amountMinor, subscription.billingFrequency) : null;
              return (
                <SubscriptionValueRow key={subscription.id} subscription={subscription} annualMinor={cost?.annualMinor ?? 0} onSave={updateSubscriptionValue} />
              );
            })}
            {optionalSubscriptions.length === 0 ? <p>No active subscriptions to review.</p> : null}
          </div>
        </section>
      </section>

      <section className="dashboard-band" id="cycle-review">
        <div className="band-header">
          <div>
            <p className="eyebrow">End-of-Cycle Savings Review</p>
            <h2>Cycle savings posture</h2>
          </div>
        </div>
        <div className="coach-metric-grid">
          <div className="coach-metric">
            <span>Protected target</span>
            <strong><Amount value={review.protectedTargetMinor} /></strong>
          </div>
          <div className="coach-metric">
            <span>Completed protected</span>
            <strong><Amount value={review.completedProtectedMinor} /></strong>
          </div>
          <div className="coach-metric">
            <span>Pending savings holds</span>
            <strong><Amount value={review.pendingProtectedMinor} /></strong>
          </div>
        </div>
        <div className="checklist">
          {review.topSuggestions.map((suggestion) => (
            <div className="check-item" key={suggestion}>
              <CheckCircle2 size={16} aria-hidden="true" />
              <span>{suggestion}</span>
            </div>
          ))}
          {review.topSuggestions.length === 0 ? <p>Cycle savings review has no open suggestions.</p> : null}
        </div>
      </section>
    </>
  );
}

function SummaryMetric({ icon, label, value, text }: { icon: React.ReactNode; label: string; value?: number; text?: string }) {
  return (
    <div className="metric-card static">
      <span className="metric-icon">{icon}</span>
      <span>{label}</span>
      <strong className="metric-value">{value === undefined ? text : <Amount value={value} />}</strong>
    </div>
  );
}

function PurchaseCheckForm({
  categories,
  defaultDate,
  onCheck
}: {
  categories: Array<{ id: string; name: string }>;
  defaultDate: string;
  onCheck: (input: PurchaseCheckInput) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [intendedDate, setIntendedDate] = useState(defaultDate);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onCheck({
        label,
        amountMinor: parseMoneyInput(amount),
        categoryId,
        intendedDate: intendedDate as PurchaseCheckInput["intendedDate"]
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not check purchase");
    }
  }

  return (
    <form className="form-grid compact-form" onSubmit={submit}>
      <label className="span-2">
        Item
        <input value={label} onChange={(event) => setLabel(event.target.value)} required />
      </label>
      <label>
        Amount
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
      </label>
      <label>
        Category
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Date
        <input type="date" value={intendedDate} onChange={(event) => setIntendedDate(event.target.value)} required />
      </label>
      {error ? <p className="form-error span-3">{error}</p> : null}
      <div className="form-actions span-3">
        <button className="primary-action" type="submit">
          Check
        </button>
      </div>
    </form>
  );
}

function SavingsGoalForm({
  defaultPriority,
  onSave
}: {
  defaultPriority: SavingsGoal["priority"];
  onSave: (goal: SavingsGoal) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<SavingsGoal["priority"]>(defaultPriority);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const goal = createSavingsGoal({
        name,
        targetMinor: parseMoneyInput(target),
        deadline: deadline ? (deadline as SavingsGoal["deadline"]) : undefined,
        priority
      });
      await onSave(goal);
      setName("");
      setTarget("");
      setDeadline("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save goal");
    }
  }

  return (
    <form className="form-grid compact-form" onSubmit={submit}>
      <label>
        Goal
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label>
        Target
        <input value={target} onChange={(event) => setTarget(event.target.value)} inputMode="decimal" required />
      </label>
      <label>
        Deadline
        <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
      </label>
      <label>
        Priority
        <select value={priority} onChange={(event) => setPriority(event.target.value as SavingsGoal["priority"])}>
          <option value="low">low</option>
          <option value="normal">normal</option>
          <option value="high">high</option>
        </select>
      </label>
      {error ? <p className="form-error span-3">{error}</p> : null}
      <div className="form-actions">
        <button className="primary-action" type="submit">
          <PiggyBank size={16} aria-hidden="true" />
          Save goal
        </button>
      </div>
    </form>
  );
}

function ManualContributionForm({
  goal,
  date,
  cycleId,
  onSave
}: {
  goal: SavingsGoal;
  date: string;
  cycleId: string;
  onSave: (contribution: SavingsGoalContribution) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSave(
        savingsGoalContribution({
          goalId: goal.id,
          amountMinor: parseMoneyInput(amount),
          occurredOn: date as SavingsGoalContribution["occurredOn"],
          source: "manual",
          status: "manual",
          linkedBudgetCycleId: cycleId
        })
      );
      setAmount("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save contribution");
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" aria-label={`${goal.name} contribution amount`} />
      <button className="secondary-action" type="submit">
        Add
      </button>
      {error ? <small className="form-error">{error}</small> : null}
    </form>
  );
}

function SubscriptionValueRow({
  subscription,
  annualMinor,
  onSave
}: {
  subscription: Subscription;
  annualMinor: number;
  onSave: (subscription: Subscription, valueRating: NonNullable<Subscription["valueRating"]>, status: SubscriptionReviewStatus) => Promise<void>;
}) {
  const [valueRating, setValueRating] = useState<NonNullable<Subscription["valueRating"]>>(subscription.valueRating ?? "useful");
  const [status, setStatus] = useState<SubscriptionReviewStatus>(subscription.status === "paused" ? "paused" : "active");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSave(subscription, valueRating, status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save subscription review");
    }
  }

  return (
    <form className="coach-card subscription-value-form" onSubmit={submit}>
      <div>
        <strong>{subscription.provider}</strong>
        <small>
          Annualised <Amount value={annualMinor} /> · next payment {formatDisplayDate(subscription.nextPaymentDate)}
        </small>
      </div>
      <label>
        Value
        <select value={valueRating} onChange={(event) => setValueRating(event.target.value as NonNullable<Subscription["valueRating"]>)}>
          <option value="essential">essential</option>
          <option value="useful">useful</option>
          <option value="maybe">maybe</option>
          <option value="rarely_used">rarely used</option>
        </select>
      </label>
      <label>
        Status
        <select value={status} onChange={(event) => setStatus(event.target.value as SubscriptionReviewStatus)}>
          <option value="active">active</option>
          <option value="paused">paused</option>
        </select>
      </label>
      <button className="secondary-action" type="submit">
        Save
      </button>
      {error ? <small className="form-error">{error}</small> : null}
    </form>
  );
}

function resultLabel(result: PurchaseCheck["result"]): string {
  switch (result) {
    case "safe":
      return "Looks safe";
    case "caution":
      return "Use caution";
    case "not_recommended":
      return "Not recommended";
  }
}
