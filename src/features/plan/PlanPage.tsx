import { useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, Plus } from "lucide-react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { addDays, formatDisplayDate } from "../../domain/dates";
import { generateRecurringPlanInstances } from "../../domain/forecasting/recurrence";
import { parseMoneyInput } from "../../domain/money";
import { createRecordMeta } from "../../domain/records";
import type { PlanInstance, RecurringRule } from "../../domain/types";
import { isActive } from "../../domain/types";
import { Amount } from "../../ui/Amount";

export function PlanPage() {
  const { snapshot, asOfDate, loading, error, saveRecord, saveRecords, saveTransaction } = useBluehourData();
  const [message, setMessage] = useState<string | null>(null);

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

      <section className="dashboard-band">
        <div className="band-header">
          <div>
            <p className="eyebrow">Timeline</p>
            <h2>Planned and expected items</h2>
          </div>
        </div>
        <div className="data-table" role="table" aria-label="Plan instances">
          <div className="data-row header" role="row">
            <span>Date</span>
            <span>Name</span>
            <span>Kind</span>
            <span>Confidence</span>
            <span>Amount</span>
            <span>Action</span>
          </div>
          {plans.map((plan) => (
            <div className="data-row" role="row" key={plan.id}>
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
                  onClick={() =>
                    void saveTransaction({
                      type: plan.kind === "income" ? "income" : "expense",
                      occurredOn: asOfDate,
                      description: plan.name,
                      amountMinor: plan.expectedAmountMinor,
                      accountId: accounts[0]?.id ?? "",
                      categoryId: plan.categoryId ?? (plan.kind === "income" ? "cat-income" : "cat-uncategorised"),
                      planInstanceId: plan.id,
                      source: "recurring_confirmation"
                    }).then(() => setMessage(`${plan.name} fulfilled as an actual transaction.`))
                  }
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
