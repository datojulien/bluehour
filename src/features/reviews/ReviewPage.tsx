import { useMemo, useState, type FormEvent } from "react";
import { Check, Save } from "lucide-react";
import { useDemoData } from "../../app/providers/DemoDataProvider";
import { calculateAccountBalances } from "../../domain/accounts/calculations";
import { formatDisplayDate } from "../../domain/dates";
import { closeSalaryCycleWithActualSalary } from "../../domain/forecasting/cycleCommands";
import { parseMoneyInput } from "../../domain/money";
import { createRecordMeta, touchRecord } from "../../domain/records";
import type { BudgetCycle, Reconciliation, ReviewSession, Transaction, TransactionLeg, TransactionSplit } from "../../domain/types";
import { isActive } from "../../domain/types";
import { Amount } from "../../ui/Amount";

interface ChecklistItem {
  id: string;
  label: string;
  complete: boolean;
}

export function ReviewPage() {
  const { snapshot, asOfDate, loading, error, saveRecord, saveRecords } = useDemoData();
  const [message, setMessage] = useState<string | null>(null);

  const balances = useMemo(
    () =>
      snapshot
        ? calculateAccountBalances(snapshot.accounts, snapshot.balanceSnapshots, snapshot.transactions, snapshot.transactionLegs, asOfDate)
        : [],
    [snapshot, asOfDate]
  );

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

  const weeklyReview = snapshot.reviewSessions.find((review) => isActive(review) && review.type === "weekly");
  const activeCycle = snapshot.budgetCycles.find((cycle) => cycle.status === "open");

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

      {activeCycle ? (
        <CycleClosePanel
          cycle={activeCycle}
          accounts={snapshot.accounts.filter(isActive)}
          incomeCategoryId={snapshot.categories.find((category) => category.name === "Income")?.id ?? "cat-income"}
          categories={snapshot.categories}
          allocations={snapshot.budgetAllocations}
          plans={snapshot.planInstances.filter(isActive)}
          transactions={snapshot.transactions.filter(isActive)}
          onClose={async (result) => {
            await saveRecords(
              [
                { storeName: "budgetCycles", record: result.closedCycle },
                { storeName: "budgetCycles", record: result.newCycle },
                { storeName: "transactions", record: result.salaryTransaction },
                { storeName: "transactionLegs", record: result.salaryLeg },
                { storeName: "transactionSplits", record: result.salarySplit },
                ...result.nextAllocations.map((record) => ({ storeName: "budgetAllocations" as const, record }))
              ],
              "salary cycle close"
            );
            setMessage("Salary cycle closed and the next cycle budget template was created.");
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
  onClose
}: {
  cycle: BudgetCycle;
  accounts: Array<{ id: string; name: string }>;
  incomeCategoryId: string;
  categories: Parameters<typeof closeSalaryCycleWithActualSalary>[0]["categories"];
  allocations: Parameters<typeof closeSalaryCycleWithActualSalary>[0]["allocations"];
  plans: Array<{ id: string; name: string; expectedAmountMinor: number; status: string; linkedTransactionId?: string }>;
  transactions: Transaction[];
  onClose: (result: ReturnType<typeof closeSalaryCycleWithActualSalary>) => Promise<void>;
}) {
  const [actualSalaryDate, setActualSalaryDate] = useState<string>(cycle.expectedNextSalaryTo);
  const [salaryDeposit, setSalaryDeposit] = useState("");
  const [destinationAccountId, setDestinationAccountId] = useState(accounts[0]?.id ?? "");
  const [skipNote, setSkipNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fulfilledPlans = plans.filter((plan) => plan.status === "fulfilled" && plan.linkedTransactionId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (!skipNote.trim()) {
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
      <div className="stack-list">
        {fulfilledPlans.slice(0, 5).map((plan) => {
          const actual = transactions.find((transaction) => transaction.id === plan.linkedTransactionId);
          return (
            <div className="stack-row" key={plan.id}>
              <span>
                <strong>{plan.name}</strong>
                <small>Expected versus actual preserved by plan link</small>
              </span>
              <span>{actual ? formatDisplayDate(actual.occurredOn) : "Linked"}</span>
            </div>
          );
        })}
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
          Reconciliation skip note
          <input value={skipNote} onChange={(event) => setSkipNote(event.target.value)} required />
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const statedBalanceMinor = parseMoneyInput(stated);
      const differenceMinor = statedBalanceMinor - calculatedBalanceMinor;
      if (differenceMinor !== 0 && createAdjustment && !note.trim()) {
        throw new Error("A reconciliation adjustment requires a note");
      }

      const transactionId = differenceMinor !== 0 && createAdjustment ? createRecordMeta("txn").id : undefined;
      const reconciliation: Reconciliation = {
        ...createRecordMeta("recon"),
        accountId,
        asOfDate: date as Reconciliation["asOfDate"],
        calculatedBalanceMinor,
        statedBalanceMinor,
        differenceMinor,
        status: differenceMinor === 0 ? "matched" : createAdjustment ? "adjusted" : "skipped",
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
            deltaMinor: differenceMinor
          }
        : undefined;
      const split: TransactionSplit | undefined = transaction
        ? {
            ...createRecordMeta("split"),
            transactionId: transaction.id,
            categoryId: "cat-reconciliation",
            direction: differenceMinor >= 0 ? "income" : "expense",
            amountMinor: Math.abs(differenceMinor)
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
      <input value={stated} onChange={(event) => setStated(event.target.value)} inputMode="decimal" />
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Required for adjustment" />
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
