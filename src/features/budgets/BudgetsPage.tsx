import { useMemo, useState, type FormEvent } from "react";
import { ArrowRightLeft, Save } from "lucide-react";
import { useDemoData } from "../../app/providers/DemoDataProvider";
import { calculateCategoryAllocation } from "../../domain/budgets/calculations";
import { formatDisplayDate } from "../../domain/dates";
import { parseMoneyInput } from "../../domain/money";
import { createRecordMeta, touchRecord } from "../../domain/records";
import { calculateCategoryActuals } from "../../domain/transactions/calculations";
import type { BudgetAllocation, BudgetTransfer, Category } from "../../domain/types";
import { isActive } from "../../domain/types";
import { Amount } from "../../ui/Amount";

export function BudgetsPage() {
  const { snapshot, asOfDate, loading, error, saveRecord } = useDemoData();
  const [message, setMessage] = useState<string | null>(null);

  const activeCycle = snapshot?.budgetCycles.find((cycle) => cycle.status === "open");

  const rows = useMemo(() => {
    if (!snapshot || !activeCycle) {
      return [];
    }

    return snapshot.categories
      .filter((category) => isActive(category) && category.active && category.reservationMode !== "none")
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((category) => {
        const allocation = snapshot.budgetAllocations.find(
          (item) => isActive(item) && item.budgetCycleId === activeCycle.id && item.categoryId === category.id
        );
        const allocated = calculateCategoryAllocation(category.id, activeCycle, snapshot.budgetAllocations, snapshot.budgetTransfers);
        const spent = calculateCategoryActuals(category.id, snapshot.transactions, snapshot.transactionSplits, activeCycle.startedOn, asOfDate);
        const remaining = allocated - spent;
        const percentage = allocated > 0 ? Math.min(999, Math.round((spent * 100) / allocated)) : 0;
        return { category, allocation, allocated, spent, remaining, percentage };
      });
  }, [snapshot, activeCycle, asOfDate]);

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
      </div>

      {message ? <section className="alert-band">{message}</section> : null}

      <BudgetTransferForm
        cycleId={cycle.id}
        categories={snapshot.categories.filter((category) => isActive(category) && category.nature === "discretionary")}
        onSave={async (transfer) => {
          await saveRecord("budgetTransfers", transfer, "budget transfer");
          setMessage("Budget transfer saved. No account transaction was created.");
        }}
      />

      <section className="dashboard-band">
        <div className="band-header">
          <div>
            <p className="eyebrow">Allocations</p>
            <h2>Cycle progress</h2>
          </div>
        </div>
        <div className="data-table" role="table" aria-label="Budget allocations">
          <div className="data-row header" role="row">
            <span>Category</span>
            <span>Mode</span>
            <span>Allocated</span>
            <span>Spent</span>
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
    allocated: number;
    spent: number;
    remaining: number;
    percentage: number;
  };
  onSave: (allocation: BudgetAllocation | undefined, category: Category, amountText: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState((row.allocated / 100).toFixed(2));
  const state = row.remaining < 0 ? "overspent" : row.percentage >= 80 ? "near limit" : "on track";

  return (
    <div className={`data-row budget-state-${state.replace(" ", "-")}`} role="row">
      <span>
        <strong>{row.category.name}</strong>
        <small>{state}</small>
      </span>
      <span>{row.category.reservationMode}</span>
      <Amount value={row.allocated} />
      <Amount value={row.spent} />
      <Amount value={row.remaining} />
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
  onSave
}: {
  cycleId: string;
  categories: Category[];
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
      await onSave({
        ...createRecordMeta("transfer"),
        budgetCycleId: cycleId,
        fromCategoryId,
        toCategoryId,
        amountMinor: parseMoneyInput(amount),
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
                {category.name}
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
