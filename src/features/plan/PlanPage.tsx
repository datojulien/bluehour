import { useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, Plus } from "lucide-react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { addDays, formatDisplayDate } from "../../domain/dates";
import { generateRecurringPlanInstances } from "../../domain/forecasting/recurrence";
import { parseMoneyInput } from "../../domain/money";
import { createRecordMeta } from "../../domain/records";
import type { TransactionDraft } from "../../domain/transactions/commands";
import type { PlanInstance, RecurringRule } from "../../domain/types";
import { isActive } from "../../domain/types";
import { Amount } from "../../ui/Amount";

export function PlanPage() {
  const { snapshot, asOfDate, loading, error, saveRecord, saveRecords, saveTransaction } = useBluehourData();
  const [message, setMessage] = useState<string | null>(null);
  const [fulfillingPlanId, setFulfillingPlanId] = useState<string | null>(null);

  const plans = useMemo(
    () =>
      [...(snapshot?.planInstances ?? [])]
        .filter(isActive)
        .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate)),
    [snapshot]
  );

  if (loading) {
    return <div className="loading-state">Opening plans…</div>;
  }

  if (error || !snapshot) {
    return (
      <section className="empty-state">
        <h1>Plan</h1>
        <p>{error ?? "Plan data is unavailable."}</p>
      </section>
    );
  }

  const accounts = snapshot.accounts.filter(isActive);
  const categories = snapshot.categories.filter((category) => isActive(category) && category.active);
  const fulfillingPlan = fulfillingPlanId ? plans.find((plan) => plan.id === fulfillingPlanId) : undefined;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Forecast</p>
          <h1>Plan</h1>
        </div>
      </div>

      {message ? <section className="alert-band">{message}</section> : null}

      <section className="two-column">
        <PlanForm
          categories={categories}
          defaultDate={asOfDate}
          onSave={async (plan) => {
            await saveRecord("planInstances", plan, "plan");
            setMessage("Plan saved locally.");
          }}
        />
        <RecurringRuleForm
          accounts={accounts}
          categories={categories}
          fromDate={asOfDate}
          onSave={async (rule) => {
            const generated = generateRecurringPlanInstances(rule, asOfDate, addDays(asOfDate, 90));
            await saveRecords(
              [
                { storeName: "recurringRules", record: rule },
                ...generated.map((record) => ({ storeName: "planInstances" as const, record }))
              ],
              "recurring rule"
            );
            setMessage(`Recurring rule saved with ${generated.length} planned instances.`);
          }}
        />
      </section>

      {fulfillingPlan ? (
        <PlanFulfilmentForm
          plan={fulfillingPlan}
          accounts={accounts}
          categories={categories}
          defaultDate={asOfDate}
          onCancel={() => setFulfillingPlanId(null)}
          onSave={async (draft) => {
            await saveTransaction(draft);
            setFulfillingPlanId(null);
            setMessage(`${fulfillingPlan.name} fulfilled with planned-versus-actual variance preserved.`);
          }}
        />
      ) : null}

      <section className="dashboard-band">
        <div className="band-header">
          <div>
            <p className="eyebrow">Timeline</p>
            <h2>Planned and expected items</h2>
          </div>
        </div>
        <div className="data-table" role="region" aria-label="Plan instances">
          <div className="data-row header">
            <span>Date</span>
            <span>Name</span>
            <span>Kind</span>
            <span>Confidence</span>
            <span>Amount</span>
            <span>Action</span>
          </div>
          {plans.map((plan) => (
            <div className="data-row" key={plan.id}>
              <span>{formatDisplayDate(plan.expectedDate)}</span>
              <span>
                <strong>{plan.name}</strong>
                <small>{plan.status}</small>
              </span>
              <span>{plan.kind}</span>
              <span>{plan.confidence}</span>
              <Amount value={plan.expectedAmountMinor} />
              {plan.status === "scheduled" && plan.kind !== "transfer" ? (
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Fulfil ${plan.name}`}
                  onClick={() => setFulfillingPlanId(plan.id)}
                >
                  <CheckCircle2 size={16} aria-hidden="true" />
                </button>
              ) : (
                <span>Linked</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function PlanFulfilmentForm({
  plan,
  accounts,
  categories,
  defaultDate,
  onCancel,
  onSave
}: {
  plan: PlanInstance;
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  defaultDate: string;
  onCancel: () => void;
  onSave: (draft: TransactionDraft) => Promise<void>;
}) {
  const [actualDate, setActualDate] = useState(defaultDate);
  const [actualAmount, setActualAmount] = useState((plan.expectedAmountMinor / 100).toFixed(2));
  const [accountId, setAccountId] = useState(plan.accountId ?? accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(plan.categoryId ?? (plan.kind === "income" ? "cat-income" : "cat-uncategorised"));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = actualAmount ? parseMoneyInputSafe(actualAmount) : 0;
  const amountVariance = parsedAmount - plan.expectedAmountMinor;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (!accountId) {
        throw new Error("Choose an account for the actual transaction");
      }

      await onSave({
        type: plan.kind === "income" ? "income" : "expense",
        occurredOn: actualDate as PlanInstance["expectedDate"],
        description: plan.name,
        amountMinor: parseMoneyInput(actualAmount),
        accountId,
        categoryId,
        planInstanceId: plan.id,
        note: note || `Expected ${formatDisplayDate(plan.expectedDate)} for RM${(plan.expectedAmountMinor / 100).toFixed(2)}.`,
        source: "recurring_confirmation"
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not fulfil plan");
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Confirmation</p>
          <h2>Fulfil planned item</h2>
        </div>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label className="span-2">
          Actual description
          <input value={plan.name} readOnly />
        </label>
        <label>
          Actual date
          <input type="date" value={actualDate} onChange={(event) => setActualDate(event.target.value)} required />
        </label>
        <label>
          Actual amount
          <input value={actualAmount} onChange={(event) => setActualAmount(event.target.value)} inputMode="decimal" required />
        </label>
        <label>
          Account
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="span-3">
          Note
          <input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <dl className="summary-list span-3">
          <div>
            <dt>Expected</dt>
            <dd>
              {formatDisplayDate(plan.expectedDate)} · <Amount value={plan.expectedAmountMinor} />
            </dd>
          </div>
          <div>
            <dt>Variance</dt>
            <dd>
              <Amount value={amountVariance} />
            </dd>
          </div>
        </dl>
        {error ? <p className="form-error span-3">{error}</p> : null}
        <div className="form-actions span-3">
          <button className="secondary-action" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-action" type="submit">
            Confirm actual
          </button>
        </div>
      </form>
    </section>
  );
}

function PlanForm({
  categories,
  defaultDate,
  onSave
}: {
  categories: Array<{ id: string; name: string }>;
  defaultDate: string;
  onSave: (plan: PlanInstance) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PlanInstance["kind"]>("expense");
  const [expectedDate, setExpectedDate] = useState(defaultDate);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [confidence, setConfidence] = useState<PlanInstance["confidence"]>("expected");
  const [essential, setEssential] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSave({
        ...createRecordMeta("plan"),
        kind,
        name,
        expectedDate: expectedDate as PlanInstance["expectedDate"],
        expectedAmountMinor: parseMoneyInput(amount),
        confidence,
        reservation: "reserved",
        status: "scheduled",
        categoryId: kind === "income" ? undefined : categoryId,
        essential
      });
      setName("");
      setAmount("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save plan");
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">One-off</p>
          <h2>Planned item</h2>
        </div>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label className="span-2">
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Kind
          <select value={kind} onChange={(event) => setKind(event.target.value as PlanInstance["kind"])}>
            <option value="expense">expense</option>
            <option value="income">income</option>
            <option value="transfer">transfer</option>
          </select>
        </label>
        <label>
          Date
          <input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} required />
        </label>
        <label>
          Amount
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
        </label>
        <label>
          Confidence
          <select value={confidence} onChange={(event) => setConfidence(event.target.value as PlanInstance["confidence"])}>
            <option value="expected">expected</option>
            <option value="confirmed">confirmed</option>
            <option value="possible">possible</option>
          </select>
        </label>
        <label>
          Category
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} disabled={kind === "income"}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={essential} onChange={(event) => setEssential(event.target.checked)} />
          Essential
        </label>
        {error ? <p className="form-error span-3">{error}</p> : null}
        <div className="form-actions span-3">
          <button className="primary-action" type="submit">
            <Plus size={16} aria-hidden="true" />
            Save plan
          </button>
        </div>
      </form>
    </section>
  );
}

function RecurringRuleForm({
  accounts,
  categories,
  fromDate,
  onSave
}: {
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  fromDate: string;
  onSave: (rule: RecurringRule) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<RecurringRule["frequency"]>("monthly");
  const [kind, setKind] = useState<RecurringRule["kind"]>("expense");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSave({
        ...createRecordMeta("rule"),
        name,
        kind,
        frequency,
        interval: 1,
        startDate: fromDate as RecurringRule["startDate"],
        dayOfMonth: Number.parseInt(fromDate.slice(-2), 10),
        amountMode: "fixed",
        amountMinor: parseMoneyInput(amount),
        fromAccountId: kind === "expense" || kind === "subscription" ? accountId : undefined,
        toAccountId: kind === "income" ? accountId : undefined,
        categoryId: kind === "income" ? undefined : categoryId,
        essential: true,
        active: true
      });
      setName("");
      setAmount("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save recurring rule");
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Recurring</p>
          <h2>Template</h2>
        </div>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label className="span-2">
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Kind
          <select value={kind} onChange={(event) => setKind(event.target.value as RecurringRule["kind"])}>
            <option value="expense">expense</option>
            <option value="income">income</option>
            <option value="subscription">subscription</option>
          </select>
        </label>
        <label>
          Frequency
          <select value={frequency} onChange={(event) => setFrequency(event.target.value as RecurringRule["frequency"])}>
            <option value="weekly">weekly</option>
            <option value="monthly">monthly</option>
            <option value="quarterly">quarterly</option>
            <option value="yearly">yearly</option>
          </select>
        </label>
        <label>
          Amount
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
        </label>
        <label>
          Account
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} disabled={kind === "income"}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        {error ? <p className="form-error span-3">{error}</p> : null}
        <div className="form-actions span-3">
          <button className="primary-action" type="submit">
            Save recurring rule
          </button>
        </div>
      </form>
    </section>
  );
}

function parseMoneyInputSafe(value: string): number {
  try {
    return parseMoneyInput(value);
  } catch {
    return 0;
  }
}
