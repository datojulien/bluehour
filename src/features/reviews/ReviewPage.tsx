import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Save } from "lucide-react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { calculateAccountBalances } from "../../domain/accounts/calculations";
import { formatDisplayDate, isOnOrAfter } from "../../domain/dates";
import { closeSalaryCycleWithActualSalary } from "../../domain/forecasting/cycleCommands";
import { decideImportAudit, parseAuditCandidates, transactionDraftFromAudit } from "../../domain/imports/importAudit";
import { parseMoneyInput, percentageOfMinor } from "../../domain/money";
import { createRecordMeta, touchRecord } from "../../domain/records";
import { dailyReviewTasks, parseDailyReviewItems, upsertDailyReviewSession } from "../../domain/reviews/dailyReview";
import { createTransactionRecords } from "../../domain/transactions/commands";
import { calculateCategoryActuals } from "../../domain/transactions/calculations";
import type { BudgetAllocation, BudgetCycle, Category, ImportRowAudit, Reconciliation, ReviewSession, Transaction, TransactionLeg, TransactionSplit } from "../../domain/types";
import { isActive } from "../../domain/types";
import { Amount } from "../../ui/Amount";
import { BudgetCoachPanel } from "../budgets/BudgetCoachPanel";
import {
  allocationRecordsFromRecommendation,
  appendBudgetCoachDecision,
  budgetCoachPreferenceRecord,
  buildBudgetCoachInputForCycle,
  readBudgetCoachPreferences
} from "../budgets/budgetCoachSettings";
import { GeminiCycleReportPanel, type SelectedGeminiNextBudgetPlan } from "./GeminiCycleReportPanel";

interface ChecklistItem {
  id: string;
  label: string;
  complete: boolean;
}

export function ReviewPage() {
  const { snapshot, asOfDate, loading, error, isDemo, saveRecord, saveRecords } = useBluehourData();
  const [message, setMessage] = useState<string | null>(null);
  const [geminiNextBudgetPlan, setGeminiNextBudgetPlan] = useState<SelectedGeminiNextBudgetPlan | null>(null);

  const balances = useMemo(
    () =>
      snapshot
        ? calculateAccountBalances(snapshot.accounts, snapshot.balanceSnapshots, snapshot.transactions, snapshot.transactionLegs, asOfDate)
        : [],
    [snapshot, asOfDate]
  );
  const activeCycle = useMemo(() => snapshot?.budgetCycles.find((cycle) => cycle.status === "open"), [snapshot]);
  const coachPreferences = useMemo(() => (snapshot ? readBudgetCoachPreferences(snapshot.settings, snapshot.categories) : null), [snapshot]);
  const coachInput = useMemo(
    () =>
      snapshot && activeCycle && coachPreferences
        ? buildBudgetCoachInputForCycle({
            snapshot,
            cycle: activeCycle,
            asOfDate,
            preferences: coachPreferences
          })
        : null,
    [activeCycle, asOfDate, coachPreferences, snapshot]
  );
  const dailyTasks = useMemo(() => (snapshot ? dailyReviewTasks(snapshot, asOfDate) : []), [asOfDate, snapshot]);
  const dailyReview = useMemo(
    () => snapshot?.reviewSessions.find((review) => isActive(review) && review.type === "daily" && review.periodKey === asOfDate),
    [asOfDate, snapshot]
  );
  const desiredDailyReview = useMemo(
    () => (snapshot ? upsertDailyReviewSession(dailyReview, dailyTasks, asOfDate) : null),
    [asOfDate, dailyReview, dailyTasks, snapshot]
  );

  useEffect(() => {
    if (!desiredDailyReview || loading || error || !snapshot) {
      return;
    }
    if (
      !dailyReview ||
      dailyReview.itemsJson !== desiredDailyReview.itemsJson ||
      dailyReview.status !== desiredDailyReview.status ||
      dailyReview.completedAt !== desiredDailyReview.completedAt
    ) {
      void saveRecord("reviewSessions", desiredDailyReview, "daily review checklist");
    }
  }, [dailyReview, desiredDailyReview, error, loading, saveRecord, snapshot]);

  if (loading) {
    return <div className="loading-state">Opening review…</div>;
  }

  if (error || !snapshot) {
    return (
      <section className="empty-state">
        <h1>Review</h1>
        <p>{error ?? "Review data is unavailable."}</p>
      </section>
    );
  }

  const loadedSnapshot = snapshot;
  const weeklyReview = snapshot.reviewSessions.find((review) => isActive(review) && review.type === "weekly");
  const uncertainImportAudits = snapshot.importRowAudits.filter((audit) => isActive(audit) && audit.outcome === "uncertain");
  const ruleReviews = snapshot.reviewSessions.filter((review) => isActive(review) && review.periodKey.startsWith("rule:") && review.status === "open");
  const activeAccounts = snapshot.accounts.filter(isActive);
  const cycleCloseReview = activeCycle
    ? snapshot.reviewSessions.find((review) => isActive(review) && review.type === "cycle_close" && review.periodKey === activeCycle.id)
    : undefined;
  const reconciliationComplete = activeCycle
    ? activeAccounts
        .filter((account) => account.reconcileWeekly)
        .every((account) =>
          snapshot.reconciliations.some(
            (reconciliation) =>
              isActive(reconciliation) &&
              reconciliation.accountId === account.id &&
              ["matched", "resolved", "adjusted"].includes(reconciliation.status) &&
              isOnOrAfter(reconciliation.asOfDate, activeCycle.startedOn)
          )
        )
    : false;

  async function toggleChecklistItem(review: ReviewSession, itemId: string) {
    const items = parseItems(review).map((item) => (item.id === itemId ? { ...item, complete: !item.complete } : item));
    const completed = items.every((item) => item.complete);
    await saveRecord(
      "reviewSessions",
      {
        ...touchRecord(review),
        itemsJson: JSON.stringify(items),
        status: completed ? "completed" : "open",
        completedAt: completed ? new Date().toISOString() : undefined
      },
      "review checklist"
    );
  }

  async function completeReview(review: ReviewSession) {
    await saveRecord(
      "reviewSessions",
      {
        ...touchRecord(review),
        status: "completed",
        completedAt: new Date().toISOString()
      },
      "review checklist"
    );
  }

  async function createCycleCloseReview(cycle: BudgetCycle) {
    await saveRecord(
      "reviewSessions",
      {
        ...createRecordMeta("review"),
        type: "cycle_close",
        periodKey: cycle.id,
        status: "open",
        itemsJson: JSON.stringify(cycleCloseChecklistItems())
      },
      "cycle close checklist"
    );
  }

  async function linkImportAudit(audit: ImportRowAudit, transactionId: string) {
    await saveRecord("importRowAudits", decideImportAudit(audit, "user_linked", transactionId), "import audit decision");
    setMessage("Import row linked to an existing transaction.");
  }

  async function createImportAuditAsNew(audit: ImportRowAudit) {
    const draft = transactionDraftFromAudit(audit);
    const result = createTransactionRecords(
      {
        type: draft.type,
        occurredOn: draft.occurredOn,
        description: draft.description,
        amountMinor: draft.amountMinor,
        accountId: draft.accountId,
        categoryId: draft.type === "income" ? "cat-income" : "cat-uncategorised",
        importBatchId: draft.importBatchId,
        importFingerprint: draft.importFingerprint,
        source: "csv_import"
      },
      loadedSnapshot
    );
    await saveRecords(
      [
        { storeName: "transactions", record: result.transaction },
        ...result.legs.map((record) => ({ storeName: "transactionLegs" as const, record })),
        ...result.splits.map((record) => ({ storeName: "transactionSplits" as const, record })),
        { storeName: "importRowAudits", record: decideImportAudit(audit, "created", result.transaction.id) }
      ],
      "import audit decision"
    );
    setMessage("Import row created as a new transaction.");
  }

  async function ignoreImportAudit(audit: ImportRowAudit) {
    await saveRecord("importRowAudits", decideImportAudit(audit, "ignored"), "import audit decision");
    setMessage("Import row ignored.");
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Review</h1>
        </div>
        <div className="date-chip">{formatDisplayDate(asOfDate)}</div>
      </div>

      {message ? <section className="alert-band">{message}</section> : null}

      <section className="two-column">
        <section className="dashboard-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">Daily</p>
              <h2>Review checklist</h2>
            </div>
          </div>
          {desiredDailyReview && parseDailyReviewItems(desiredDailyReview).length > 0 ? (
            <div className="checklist">
              {parseDailyReviewItems(desiredDailyReview).map((item) => (
                <button
                  className={`check-item${item.complete ? " complete" : ""}`}
                  type="button"
                  key={item.id}
                  onClick={() => void toggleChecklistItem(desiredDailyReview, item.id)}
                >
                  <Check size={16} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <p>No open daily tasks.</p>
          )}
        </section>

        <section className="dashboard-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">Weekly</p>
              <h2>Checklist</h2>
            </div>
          </div>
          {weeklyReview ? (
            <div className="checklist">
              {parseItems(weeklyReview).map((item) => (
                <button className={`check-item${item.complete ? " complete" : ""}`} type="button" key={item.id} onClick={() => void toggleChecklistItem(weeklyReview, item.id)}>
                  <Check size={16} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <p>No open weekly checklist.</p>
          )}
        </section>

        <section className="dashboard-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">History</p>
              <h2>Reconciliations</h2>
            </div>
          </div>
          <div className="stack-list">
            {snapshot.reconciliations.filter(isActive).map((reconciliation) => (
              <div className="stack-row" key={reconciliation.id}>
                <span>
                  <strong>{snapshot.accounts.find((account) => account.id === reconciliation.accountId)?.name}</strong>
                  <small>{formatDisplayDate(reconciliation.asOfDate)} · {reconciliation.status}</small>
                </span>
                <Amount value={reconciliation.differenceMinor} />
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="dashboard-band">
        <div className="band-header">
          <div>
            <p className="eyebrow">Weekly reconciliation</p>
            <h2>Enabled accounts</h2>
          </div>
        </div>
        <div className="data-table">
          <div className="data-row header">
            <span>Account</span>
            <span>Calculated</span>
            <span>Institution balance</span>
            <span>Note</span>
            <span>Save</span>
          </div>
          {balances
            .filter(({ account }) => account.reconcileWeekly)
            .map((balance) => (
              <ReconciliationRow
                key={balance.account.id}
                accountId={balance.account.id}
                accountName={balance.account.name}
                calculatedBalanceMinor={balance.balanceMinor}
                date={asOfDate}
                onSave={async ({ reconciliation, transaction, leg, split }) => {
                  await saveRecords(
                    [
                      { storeName: "reconciliations", record: reconciliation },
                      ...(transaction ? [{ storeName: "transactions" as const, record: transaction }] : []),
                      ...(leg ? [{ storeName: "transactionLegs" as const, record: leg }] : []),
                      ...(split ? [{ storeName: "transactionSplits" as const, record: split }] : [])
                    ],
                    "reconciliation"
                  );
                  setMessage("Reconciliation saved.");
                }}
              />
            ))}
        </div>
      </section>

      {uncertainImportAudits.length > 0 ? (
        <section className="dashboard-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">CSV import</p>
              <h2>Uncertain duplicate rows</h2>
            </div>
          </div>
          <div className="stack-list">
            {uncertainImportAudits.map((audit) => {
              const candidates = parseAuditCandidates(audit);
              return (
              <div className="stack-row import-audit-row" key={audit.id}>
                <span>
                  <strong>{audit.description}</strong>
                  <small>
                    {formatDisplayDate(audit.occurredOn)} · <Amount value={Math.abs(audit.signedAmountMinor)} /> · {candidates.length} candidate{candidates.length === 1 ? "" : "s"}
                  </small>
                </span>
                <span className="inline-actions">
                  {candidates.slice(0, 3).map((candidate) => {
                    const transaction = snapshot.transactions.find((record) => record.id === candidate.transactionId);
                    return (
                      <button
                        className="secondary-action"
                        type="button"
                        key={candidate.transactionId}
                        aria-label={`Link imported row ${audit.description} to ${transaction?.description ?? candidate.transactionId}`}
                        onClick={() => void linkImportAudit(audit, candidate.transactionId)}
                      >
                        Link {candidate.score}
                      </button>
                    );
                  })}
                  <button className="secondary-action" type="button" onClick={() => void createImportAuditAsNew(audit)}>
                    Create new
                  </button>
                  <button className="secondary-action" type="button" onClick={() => void ignoreImportAudit(audit)}>
                    Ignore
                  </button>
                </span>
              </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {ruleReviews.length > 0 ? (
        <section className="dashboard-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">Categorisation</p>
              <h2>Rule application conflicts</h2>
            </div>
          </div>
          <div className="stack-list">
            {ruleReviews.map((review) => (
              <div className="stack-row" key={review.id}>
                <span>
                  <strong>{review.periodKey.replace("rule:", "Rule ")}</strong>
                  <small>{parseCsvReviewItems(review).length} historical transaction{parseCsvReviewItems(review).length === 1 ? "" : "s"} need a category decision.</small>
                </span>
                <button className="secondary-action" type="button" onClick={() => void completeReview(review)}>
                  Mark reviewed
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeCycle ? (
        <GeminiCycleReportPanel
          snapshot={snapshot}
          cycle={activeCycle}
          asOfDate={asOfDate}
          isDemo={isDemo}
          selectedPlan={geminiNextBudgetPlan}
          onSelectNextBudget={setGeminiNextBudgetPlan}
          onClearNextBudget={() => setGeminiNextBudgetPlan(null)}
        />
      ) : null}

      {activeCycle ? (
        <CycleClosePanel
          cycle={activeCycle}
          accounts={activeAccounts}
          incomeCategoryId={snapshot.categories.find((category) => category.name === "Income")?.id ?? "cat-income"}
          categories={snapshot.categories}
          allocations={snapshot.budgetAllocations}
          plans={snapshot.planInstances.filter(isActive)}
          transactions={snapshot.transactions.filter(isActive)}
          transactionSplits={snapshot.transactionSplits.filter(isActive)}
          cycleCloseReview={cycleCloseReview}
          reconciliationComplete={reconciliationComplete}
          nextBudgetSourceLabel={geminiNextBudgetPlan ? `Gemini proposal from ${geminiNextBudgetPlan.model}` : undefined}
          onClearNextBudgetSource={() => setGeminiNextBudgetPlan(null)}
          onCreateCycleCloseReview={() => createCycleCloseReview(activeCycle)}
          onToggleCycleCloseItem={(itemId) => {
            if (cycleCloseReview) {
              void toggleChecklistItem(cycleCloseReview, itemId);
            }
          }}
          onClose={async (result) => {
            const nextAllocations = geminiNextBudgetPlan
              ? allocationsForNextCycleWithGeminiProposal({
                  clonedAllocations: result.nextAllocations,
                  newCycleId: result.newCycle.id,
                  categories: snapshot.categories,
                  plan: geminiNextBudgetPlan
                })
              : result.nextAllocations;
            await saveRecords(
              [
                { storeName: "budgetCycles", record: result.closedCycle },
                { storeName: "budgetCycles", record: result.newCycle },
                { storeName: "transactions", record: result.salaryTransaction },
                { storeName: "transactionLegs", record: result.salaryLeg },
                { storeName: "transactionSplits", record: result.salarySplit },
                ...nextAllocations.map((record) => ({ storeName: "budgetAllocations" as const, record }))
              ],
              "salary cycle close"
            );
            setGeminiNextBudgetPlan(null);
            setMessage(
              geminiNextBudgetPlan
                ? "Salary cycle closed and the Gemini next-cycle budget proposal was applied."
                : "Salary cycle closed and the next cycle budget template was created."
            );
          }}
        />
      ) : null}

      {activeCycle && coachPreferences ? (
        <BudgetCoachPanel
          title="Prepare the next cycle"
          input={coachInput}
          preferences={coachPreferences}
          categories={snapshot.categories}
          canApply
          applyLabel="Accept all for this open cycle"
          onPreferencesChange={async (preferences) => {
            await saveRecords(
              [{ storeName: "settings", record: budgetCoachPreferenceRecord(snapshot.settings, snapshot.categories, preferences) }],
              "Budget Coach preferences"
            );
            setMessage("Budget Coach preferences saved.");
          }}
          onAcceptAll={async (result, preferences) => {
            const note = `Accepted cycle-review Budget Coach ${result.profileId} recommendation with ${result.confidence} confidence.`;
            const records = allocationRecordsFromRecommendation({
              cycleId: activeCycle.id,
              categories: snapshot.categories,
              existingAllocations: snapshot.budgetAllocations,
              recommendations: result.categoryRecommendations,
              note
            });
            const acceptedPreferences = appendBudgetCoachDecision({
              preferences,
              result,
              cycleId: activeCycle.id,
              appliedCategoryIds: result.categoryRecommendations.map((recommendation) => recommendation.categoryId)
            });
            await saveRecords(
              [
                { storeName: "settings", record: budgetCoachPreferenceRecord(snapshot.settings, snapshot.categories, acceptedPreferences) },
                ...records.map((record) => ({ storeName: "budgetAllocations" as const, record }))
              ],
              "cycle-review Budget Coach recommendation"
            );
            setMessage("Budget Coach cycle recommendation applied atomically.");
          }}
          onAcceptCategory={async (categoryId, result, preferences) => {
            const recommendation = result.categoryRecommendations.find((item) => item.categoryId === categoryId);
            if (!recommendation) {
              return;
            }
            const note = `Accepted one cycle-review Budget Coach ${result.profileId} recommendation with ${recommendation.confidence} confidence.`;
            const records = allocationRecordsFromRecommendation({
              cycleId: activeCycle.id,
              categories: snapshot.categories,
              existingAllocations: snapshot.budgetAllocations,
              recommendations: [recommendation],
              note
            });
            const acceptedPreferences = appendBudgetCoachDecision({
              preferences,
              result,
              cycleId: activeCycle.id,
              appliedCategoryIds: [categoryId]
            });
            await saveRecords(
              [
                { storeName: "settings", record: budgetCoachPreferenceRecord(snapshot.settings, snapshot.categories, acceptedPreferences) },
                ...records.map((record) => ({ storeName: "budgetAllocations" as const, record }))
              ],
              "cycle-review Budget Coach category"
            );
            setMessage("One cycle-review Budget Coach recommendation applied. Other categories were not changed.");
          }}
        />
      ) : null}
    </>
  );
}

function CycleClosePanel({
  cycle,
  accounts,
  incomeCategoryId,
  categories,
  allocations,
  plans,
  transactions,
  transactionSplits,
  cycleCloseReview,
  reconciliationComplete,
  nextBudgetSourceLabel,
  onClearNextBudgetSource,
  onCreateCycleCloseReview,
  onToggleCycleCloseItem,
  onClose
}: {
  cycle: BudgetCycle;
  accounts: Array<{ id: string; name: string }>;
  incomeCategoryId: string;
  categories: readonly Category[];
  allocations: readonly BudgetAllocation[];
  plans: Array<{ id: string; name: string; expectedDate: string; expectedAmountMinor: number; status: string; linkedTransactionId?: string }>;
  transactions: Transaction[];
  transactionSplits: TransactionSplit[];
  cycleCloseReview?: ReviewSession;
  reconciliationComplete: boolean;
  nextBudgetSourceLabel?: string;
  onClearNextBudgetSource: () => void;
  onCreateCycleCloseReview: () => Promise<void>;
  onToggleCycleCloseItem: (itemId: string) => void;
  onClose: (result: ReturnType<typeof closeSalaryCycleWithActualSalary>) => Promise<void>;
}) {
  const [actualSalaryDate, setActualSalaryDate] = useState<string>(cycle.expectedNextSalaryTo);
  const [salaryDeposit, setSalaryDeposit] = useState("");
  const [destinationAccountId, setDestinationAccountId] = useState(accounts[0]?.id ?? "");
  const [skipNote, setSkipNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fulfilledPlans = plans.filter((plan) => plan.status === "fulfilled" && plan.linkedTransactionId);
  const categoryResults = allocations
    .filter((allocation) => isActive(allocation) && allocation.budgetCycleId === cycle.id)
    .slice(0, 6)
    .map((allocation) => {
      const category = categories.find((item) => item.id === allocation.categoryId);
      const spent = calculateCategoryActuals(allocation.categoryId, transactions, transactionSplits, cycle.startedOn, actualSalaryDate as BudgetCycle["startedOn"]);
      return {
        id: allocation.id,
        name: category?.name ?? allocation.categoryId,
        allocated: allocation.baseAmountMinor,
        spent,
        unused: Math.max(0, allocation.baseAmountMinor - spent)
      };
    });
  const protectedTargetMinor =
    percentageOfMinor(cycle.actualMainSalaryMinor, cycle.protectedRateBasisPoints) + (cycle.additionalProtectedCommitmentMinor ?? 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (!reconciliationComplete && !skipNote.trim()) {
        throw new Error("Cycle close requires reconciliation or an explicit skip note");
      }
      await onClose(
        closeSalaryCycleWithActualSalary({
          currentCycle: cycle,
          actualSalaryDate: actualSalaryDate as BudgetCycle["startedOn"],
          salaryDepositText: salaryDeposit,
          destinationAccountId,
          incomeCategoryId,
          categories,
          allocations,
          reconciliationComplete,
          skipReconciliationNote: skipNote
        })
      );
      setSalaryDeposit("");
      setSkipNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not close cycle");
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Salary-cycle close</p>
          <h2>Close current cycle</h2>
        </div>
      </div>
      {nextBudgetSourceLabel ? (
        <div className="alert-band">
          <span>{nextBudgetSourceLabel} will replace matching next-cycle allocations when this cycle closes.</span>
          <button className="secondary-action" type="button" onClick={onClearNextBudgetSource}>
            Use copied template instead
          </button>
        </div>
      ) : null}
      <div className="stack-list">
        <div className="stack-row">
          <span>
            <strong>Reconciliation</strong>
            <small>{reconciliationComplete ? "Enabled accounts have a reconciliation in this cycle." : "Close requires an explicit skip note."}</small>
          </span>
          <span>{reconciliationComplete ? "Complete" : "Skip note needed"}</span>
        </div>
        <div className="stack-row">
          <span>
            <strong>Protected target</strong>
            <small>Minimum contribution expected for this salary cycle.</small>
          </span>
          <Amount value={protectedTargetMinor} />
        </div>
        {fulfilledPlans.slice(0, 5).map((plan) => {
          const actual = transactions.find((transaction) => transaction.id === plan.linkedTransactionId);
          const actualAmountMinor = actual ? transactionAmount(actual.id, transactionSplits) : 0;
          const varianceMinor = actualAmountMinor - plan.expectedAmountMinor;
          return (
            <div className="stack-row" key={plan.id}>
              <span>
                <strong>{plan.name}</strong>
                <small>
                  Expected <Amount value={plan.expectedAmountMinor} /> · actual <Amount value={actualAmountMinor} /> · variance{" "}
                  <Amount value={varianceMinor} />
                </small>
              </span>
              <span>{actual ? formatDisplayDate(actual.occurredOn) : "Linked"}</span>
            </div>
          );
        })}
      </div>
      <div className="dashboard-subsection">
        <div className="inline-heading">
          <strong>Cycle-close checklist</strong>
          {!cycleCloseReview ? (
            <button className="secondary-action" type="button" onClick={() => void onCreateCycleCloseReview()}>
              Create checklist
            </button>
          ) : null}
        </div>
        {cycleCloseReview ? (
          <div className="checklist">
            {parseItems(cycleCloseReview).map((item) => (
              <button className={`check-item${item.complete ? " complete" : ""}`} type="button" key={item.id} onClick={() => onToggleCycleCloseItem(item.id)}>
                <Check size={16} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <p>No cycle-close checklist has been created for this salary cycle.</p>
        )}
      </div>
      <div className="dashboard-subsection">
        <div className="inline-heading">
          <strong>Category results</strong>
        </div>
        <div className="stack-list">
          {categoryResults.map((result) => (
            <div className="stack-row" key={result.id}>
              <span>
                <strong>{result.name}</strong>
                <small>
                  Allocated <Amount value={result.allocated} /> · spent <Amount value={result.spent} /> · unused expires{" "}
                  <Amount value={result.unused} />
                </small>
              </span>
            </div>
          ))}
        </div>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label>
          Actual salary date
          <input type="date" value={actualSalaryDate} onChange={(event) => setActualSalaryDate(event.target.value)} required />
        </label>
        <label>
          Salary deposit
          <input value={salaryDeposit} onChange={(event) => setSalaryDeposit(event.target.value)} inputMode="decimal" required />
        </label>
        <label>
          Destination account
          <select value={destinationAccountId} onChange={(event) => setDestinationAccountId(event.target.value)}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className="span-3">
          {reconciliationComplete ? "Cycle close note" : "Reconciliation skip note"}
          <input value={skipNote} onChange={(event) => setSkipNote(event.target.value)} required={!reconciliationComplete} />
        </label>
        {error ? <p className="form-error span-3">{error}</p> : null}
        <div className="form-actions span-3">
          <button className="primary-action" type="submit">
            Close cycle
          </button>
        </div>
      </form>
    </section>
  );
}

function transactionAmount(transactionId: string, splits: readonly TransactionSplit[]): number {
  return splits
    .filter((split) => split.transactionId === transactionId)
    .reduce((total, split) => {
      if (split.direction === "expense") {
        return total + split.amountMinor;
      }

      if (split.direction === "income" || split.direction === "reversal") {
        return total + split.amountMinor;
      }

      return total;
    }, 0);
}

function ReconciliationRow({
  accountId,
  accountName,
  calculatedBalanceMinor,
  date,
  onSave
}: {
  accountId: string;
  accountName: string;
  calculatedBalanceMinor: number;
  date: string;
  onSave: (records: { reconciliation: Reconciliation; transaction?: Transaction; leg?: TransactionLeg; split?: TransactionSplit }) => Promise<void>;
}) {
  const [stated, setStated] = useState((calculatedBalanceMinor / 100).toFixed(2));
  const [note, setNote] = useState("");
  const [createAdjustment, setCreateAdjustment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const differenceMinor = parseMoneyInputSafe(stated) - calculatedBalanceMinor;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const statedBalanceMinor = parseMoneyInput(stated);
      const nextDifferenceMinor = statedBalanceMinor - calculatedBalanceMinor;
      if (nextDifferenceMinor !== 0 && !note.trim()) {
        throw new Error(createAdjustment ? "A reconciliation adjustment requires a note" : "A reconciliation difference requires a note");
      }

      const transactionId = nextDifferenceMinor !== 0 && createAdjustment ? createRecordMeta("txn").id : undefined;
      const reconciliation: Reconciliation = {
        ...createRecordMeta("recon"),
        accountId,
        asOfDate: date as Reconciliation["asOfDate"],
        calculatedBalanceMinor,
        statedBalanceMinor,
        differenceMinor: nextDifferenceMinor,
        status: nextDifferenceMinor === 0 ? "matched" : createAdjustment ? "adjusted" : "skipped",
        adjustmentTransactionId: transactionId,
        note: note || undefined
      };
      const transaction: Transaction | undefined = transactionId
        ? {
            id: transactionId,
            createdAt: reconciliation.createdAt,
            updatedAt: reconciliation.updatedAt,
            archivedAt: null,
            revision: 1,
            type: "reconciliation_adjustment",
            status: "actual",
            occurredOn: reconciliation.asOfDate,
            description: `Reconciliation adjustment · ${accountName}`,
            note,
            source: "reconciliation"
          }
        : undefined;
      const leg: TransactionLeg | undefined = transaction
        ? {
            ...createRecordMeta("leg"),
            transactionId: transaction.id,
            accountId,
            deltaMinor: nextDifferenceMinor
          }
        : undefined;
      const split: TransactionSplit | undefined = transaction
        ? {
            ...createRecordMeta("split"),
            transactionId: transaction.id,
            categoryId: "cat-reconciliation",
            direction: nextDifferenceMinor >= 0 ? "income" : "expense",
            amountMinor: Math.abs(nextDifferenceMinor)
          }
        : undefined;
      await onSave({ reconciliation, transaction, leg, split });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save reconciliation");
    }
  }

  return (
    <form className="data-row" onSubmit={submit}>
      <span>
        <strong>{accountName}</strong>
        <small>{date}</small>
      </span>
      <Amount value={calculatedBalanceMinor} />
      <span>
        <input aria-label={`${accountName} institution balance`} value={stated} onChange={(event) => setStated(event.target.value)} inputMode="decimal" />
        <small>
          Difference <Amount value={differenceMinor} />
        </small>
      </span>
      <input aria-label={`${accountName} reconciliation note`} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Required for any difference" />
      <span className="inline-actions">
        <label className="checkbox-label compact">
          <input type="checkbox" checked={createAdjustment} onChange={(event) => setCreateAdjustment(event.target.checked)} />
          Adjust
        </label>
        <button className="icon-button" type="submit" aria-label={`Save reconciliation for ${accountName}`}>
          <Save size={15} aria-hidden="true" />
        </button>
        {error ? <small className="form-error">{error}</small> : null}
      </span>
    </form>
  );
}

function parseItems(review: ReviewSession): ChecklistItem[] {
  try {
    return JSON.parse(review.itemsJson) as ChecklistItem[];
  } catch {
    return [];
  }
}

function parseCsvReviewItems(review: ReviewSession): unknown[] {
  try {
    const parsed = JSON.parse(review.itemsJson) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cycleCloseChecklistItems(): ChecklistItem[] {
  return [
    { id: "reconcile", label: "Reconcile all enabled accounts", complete: false },
    { id: "plans", label: "Resolve incomplete plans", complete: false },
    { id: "variance", label: "Review planned-versus-actual variance", complete: false },
    { id: "categories", label: "Review category results", complete: false },
    { id: "protected", label: "Confirm protected contribution", complete: false },
    { id: "backup", label: "Download or confirm backup", complete: false }
  ];
}

function allocationsForNextCycleWithGeminiProposal({
  clonedAllocations,
  newCycleId,
  categories,
  plan
}: {
  clonedAllocations: readonly BudgetAllocation[];
  newCycleId: string;
  categories: readonly Category[];
  plan: SelectedGeminiNextBudgetPlan;
}): BudgetAllocation[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const allocatableCategoryIds = new Set(
    categories
      .filter(
        (category) =>
          isActive(category) &&
          category.active &&
          category.nature !== "administrative" &&
          category.nature !== "protected" &&
          category.reservationMode !== "none"
      )
      .map((category) => category.id)
  );
  const byCategory = new Map(clonedAllocations.map((allocation) => [allocation.categoryId, allocation]));
  const note = `Accepted Gemini ${plan.model} next-cycle proposal during salary-cycle close.`;

  for (const recommendation of plan.recommendations) {
    if (!allocatableCategoryIds.has(recommendation.categoryId)) {
      continue;
    }
    const existing = byCategory.get(recommendation.categoryId);
    byCategory.set(
      recommendation.categoryId,
      existing
        ? {
            ...existing,
            baseAmountMinor: recommendation.amountMinor,
            note
          }
        : {
            ...createRecordMeta("alloc"),
            budgetCycleId: newCycleId,
            categoryId: recommendation.categoryId,
            baseAmountMinor: recommendation.amountMinor,
            note
          }
    );
  }

  return [...byCategory.values()].sort((left, right) => {
    const leftCategory = categoryById.get(left.categoryId);
    const rightCategory = categoryById.get(right.categoryId);
    return (leftCategory?.sortOrder ?? 9999) - (rightCategory?.sortOrder ?? 9999) || (leftCategory?.name ?? left.categoryId).localeCompare(rightCategory?.name ?? right.categoryId);
  });
}

function parseMoneyInputSafe(value: string): number {
  try {
    return parseMoneyInput(value);
  } catch {
    return 0;
  }
}
