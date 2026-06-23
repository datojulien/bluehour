import { useMemo, useState, type FormEvent } from "react";
import { ArrowRightLeft, Save } from "lucide-react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { assertBudgetTransferSourceAvailable } from "../../domain/budgets/calculations";
import { buildBudgetProgressRows, type BudgetProgressRow as DomainBudgetProgressRow } from "../../domain/budgets/budgetProgress";
import { detectSaveDifferenceOpportunities } from "../../domain/coach/saveDifference";
import { formatDisplayDate } from "../../domain/dates";
import { parseMoneyInput } from "../../domain/money";
import { createRecordMeta, touchRecord } from "../../domain/records";
import type { BudgetAllocation, BudgetTransfer, Category } from "../../domain/types";
import { isActive } from "../../domain/types";
import { Amount } from "../../ui/Amount";
import { BudgetCoachPanel } from "./BudgetCoachPanel";
import {
  allocationRecordsFromRecommendation,
  appendBudgetCoachDecision,
  budgetCoachPreferenceRecord,
  buildBudgetCoachInputForCycle,
  readBudgetCoachPreferences
} from "./budgetCoachSettings";

export function BudgetsPage() {
  const { snapshot, asOfDate, loading, error, saveRecord, saveRecords } = useBluehourData();
  const [message, setMessage] = useState<string | null>(null);
  const [coachOpen, setCoachOpen] = useState(false);

  const activeCycle = snapshot?.budgetCycles.find((cycle) => cycle.status === "open");
  const coachPreferences = useMemo(
    () => (snapshot ? readBudgetCoachPreferences(snapshot.settings, snapshot.categories) : null),
    [snapshot]
  );
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

  const rows = useMemo(() => {
    if (!snapshot || !activeCycle) {
      return [];
    }

    return buildBudgetProgressRows({ snapshot, cycle: activeCycle, asOfDate }).map((progress) => {
        const allocation = snapshot.budgetAllocations.find(
          (item) => isActive(item) && item.budgetCycleId === activeCycle.id && item.categoryId === progress.categoryId
        );
        return { ...progress, allocation };
      });
  }, [snapshot, activeCycle, asOfDate]);
  const saveDifferenceRows = useMemo(
    () => (snapshot && activeCycle ? detectSaveDifferenceOpportunities(snapshot, activeCycle, asOfDate).slice(0, 3) : []),
    [activeCycle, asOfDate, snapshot]
  );

  if (loading) {
    return <div className="loading-state">Opening budgets…</div>;
  }

  if (error || !snapshot || !activeCycle) {
    return (
      <section className="empty-state">
        <h1>Budgets</h1>
        <p>{error ?? "No open salary cycle is available."}</p>
      </section>
    );
  }

  const cycle = activeCycle;

  async function updateAllocation(allocation: BudgetAllocation | undefined, category: Category, amountText: string) {
    const amountMinor = parseMoneyInput(amountText);
    const record: BudgetAllocation = allocation
      ? { ...touchRecord(allocation), baseAmountMinor: amountMinor }
      : {
          ...createRecordMeta("alloc"),
          budgetCycleId: cycle.id,
          categoryId: category.id,
          baseAmountMinor: amountMinor
        };
    await saveRecord("budgetAllocations", record, "budget allocation");
    setMessage(`${category.name} allocation saved.`);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Salary-cycle budget</p>
          <h1>
            {formatDisplayDate(activeCycle.startedOn)} to {formatDisplayDate(activeCycle.expectedNextSalaryTo)}
          </h1>
        </div>
        <button className="secondary-action" type="button" onClick={() => setCoachOpen((open) => !open)}>
          Review with Budget Coach
        </button>
        <a className="secondary-action" href="#/settings#categories">
          Manage categories
        </a>
      </div>

      {message ? <section className="alert-band">{message}</section> : null}

      {coachOpen && coachPreferences ? (
        <BudgetCoachPanel
          title="Review current salary-cycle budget"
          input={coachInput}
          preferences={coachPreferences}
          categories={snapshot.categories}
          canApply
          applyLabel="Accept all recommendations"
          onPreferencesChange={async (preferences) => {
            await saveRecords(
              [{ storeName: "settings", record: budgetCoachPreferenceRecord(snapshot.settings, snapshot.categories, preferences) }],
              "Budget Coach preferences"
            );
            setMessage("Budget Coach preferences saved.");
          }}
          onAcceptAll={async (result, preferences) => {
            const note = `Accepted Budget Coach ${result.profileId} recommendation with ${result.confidence} confidence.`;
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
              "Budget Coach recommendation"
            );
            setMessage("Budget Coach recommendations applied atomically.");
          }}
          onAcceptCategory={async (categoryId, result, preferences) => {
            const recommendation = result.categoryRecommendations.find((item) => item.categoryId === categoryId);
            if (!recommendation) {
              return;
            }
            const note = `Accepted one Budget Coach ${result.profileId} recommendation with ${recommendation.confidence} confidence.`;
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
              "Budget Coach category recommendation"
            );
            setMessage("One Budget Coach recommendation applied. Other categories were not changed.");
          }}
        />
      ) : null}

      <BudgetTransferForm
        cycleId={cycle.id}
        categories={snapshot.categories.filter((category) => isActive(category) && category.nature === "discretionary")}
        sourceAvailability={Object.fromEntries(rows.map((row) => [row.categoryId, Math.max(0, row.remainingAfterFuturePlansMinor)]))}
        onSave={async (transfer) => {
          await saveRecord("budgetTransfers", transfer, "budget transfer");
          setMessage("Budget transfer saved. No account transaction was created.");
        }}
      />

      {saveDifferenceRows.length > 0 ? (
        <section className="dashboard-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">Savings Coach</p>
              <h2>Save-the-Difference opportunities</h2>
            </div>
            <a className="secondary-action" href="#/coach#difference">
              Open Coach
            </a>
          </div>
          <div className="stack-list">
            {saveDifferenceRows.map((opportunity) => (
              <div className="stack-row" key={opportunity.categoryId}>
                <div>
                  <strong>{opportunity.categoryName}</strong>
                  <small>{opportunity.reason}</small>
                </div>
                <Amount value={opportunity.suggestedMoveMinor} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="dashboard-band">
        <div className="band-header">
          <div>
            <p className="eyebrow">Allocations</p>
            <h2>Cycle progress</h2>
          </div>
        </div>
        <div className="data-table budget-table" role="region" aria-label="Budget allocations">
          <div className="data-row header">
            <span>Category</span>
            <span>Mode</span>
            <span>Allocated</span>
            <span>Spent</span>
            <span>Reserved</span>
            <span>Remaining</span>
            <span>Edit</span>
          </div>
          {rows.map((row) => (
            <BudgetRow key={row.category.id} row={row} onSave={updateAllocation} />
          ))}
        </div>
      </section>
    </>
  );
}

function BudgetRow({
  row,
  onSave
}: {
  row: {
    category: Category;
    allocation?: BudgetAllocation;
  } & DomainBudgetProgressRow;
  onSave: (allocation: BudgetAllocation | undefined, category: Category, amountText: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState((row.allocationMinor / 100).toFixed(2));
  const state = row.state.replace("_", " ");

  return (
    <div className={`data-row budget-state-${state.replace(" ", "-")}`}>
      <span>
        <strong>{row.categoryName}</strong>
        <small>{state}</small>
      </span>
      <span>{row.category.reservationMode}</span>
      <Amount value={row.allocationMinor} />
      <Amount value={row.spentMinor} />
      <Amount value={row.reservedFuturePlansMinor} />
      <Amount value={row.remainingAfterFuturePlansMinor} />
      <form className="inline-form" onSubmit={(event) => {
        event.preventDefault();
        void onSave(row.allocation, row.category, amount);
      }}>
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" aria-label={`${row.category.name} allocation`} />
        <button className="icon-button" type="submit" aria-label={`Save ${row.category.name} allocation`}>
          <Save size={15} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

function BudgetTransferForm({
  cycleId,
  categories,
  sourceAvailability,
  onSave
}: {
  cycleId: string;
  categories: Category[];
  sourceAvailability: Record<string, number>;
  onSave: (transfer: BudgetTransfer) => Promise<void>;
}) {
  const [fromCategoryId, setFromCategoryId] = useState(categories[0]?.id ?? "");
  const [toCategoryId, setToCategoryId] = useState(categories[1]?.id ?? categories[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (fromCategoryId === toCategoryId) {
        throw new Error("Choose two different categories");
      }
      const amountMinor = parseMoneyInput(amount);
      assertBudgetTransferSourceAvailable(sourceAvailability[fromCategoryId] ?? 0, amountMinor);
      await onSave({
        ...createRecordMeta("transfer"),
        budgetCycleId: cycleId,
        fromCategoryId,
        toCategoryId,
        amountMinor,
        occurredOn: new Date().toISOString().slice(0, 10) as BudgetTransfer["occurredOn"],
        note: note || undefined
      });
      setAmount("");
      setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save transfer");
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Overspending flow</p>
          <h2>Move discretionary budget</h2>
        </div>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label>
          From
          <select value={fromCategoryId} onChange={(event) => setFromCategoryId(event.target.value)}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} · RM{((sourceAvailability[category.id] ?? 0) / 100).toFixed(2)} available
              </option>
            ))}
          </select>
        </label>
        <label>
          To
          <select value={toCategoryId} onChange={(event) => setToCategoryId(event.target.value)}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
        </label>
        <label className="span-3">
          Note
          <input value={note} onChange={(event) => setNote(event.target.value)} required />
        </label>
        {error ? <p className="form-error span-3">{error}</p> : null}
        <div className="form-actions span-3">
          <button className="primary-action" type="submit">
            <ArrowRightLeft size={16} aria-hidden="true" />
            Move budget
          </button>
        </div>
      </form>
    </section>
  );
}
