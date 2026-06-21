import { useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { addDays, formatDisplayDate, isOnOrAfter, isOnOrBefore } from "../../domain/dates";
import { parseMoneyInput } from "../../domain/money";
import { createRecordMeta, touchRecord } from "../../domain/records";
import type { PlanInstance, RecurringRule, Subscription } from "../../domain/types";
import { isActive } from "../../domain/types";
import { Amount } from "../../ui/Amount";

interface SubscriptionPriceHistoryEntry {
  changedAt: string;
  effectiveDate: string;
  previousAmountMinor: number;
  nextAmountMinor: number;
}

export function SubscriptionsPage() {
  const { snapshot, asOfDate, loading, error, saveRecords } = useBluehourData();
  const [message, setMessage] = useState<string | null>(null);

  const subscriptions = useMemo(
    () =>
      [...(snapshot?.subscriptions ?? [])]
        .filter(isActive)
        .sort((a, b) => a.nextPaymentDate.localeCompare(b.nextPaymentDate)),
    [snapshot]
  );

  if (loading) {
    return <div className="loading-state">Opening subscriptions…</div>;
  }

  if (error || !snapshot) {
    return (
      <section className="empty-state">
        <h1>Subscriptions</h1>
        <p>{error ?? "Subscription data is unavailable."}</p>
      </section>
    );
  }

  const loadedSnapshot = snapshot;
  const rulesById = new Map(loadedSnapshot.recurringRules.map((rule) => [rule.id, rule]));
  const accounts = loadedSnapshot.accounts.filter(isActive);
  const categories = loadedSnapshot.categories.filter((category) => isActive(category) && category.active);

  async function updateSubscriptionPrice(subscription: Subscription, rule: RecurringRule, nextAmountMinor: number) {
    const now = new Date().toISOString();
    const history = parsePriceHistory(subscription);
    const updatedRule: RecurringRule = {
      ...touchRecord(rule),
      amountMinor: nextAmountMinor
    };
    const updatedSubscription: Subscription = {
      ...touchRecord(subscription),
      priceHistoryJson: JSON.stringify([
        ...history,
        {
          changedAt: now,
          effectiveDate: asOfDate,
          previousAmountMinor: rule.amountMinor,
          nextAmountMinor
        } satisfies SubscriptionPriceHistoryEntry
      ])
    };
    const futurePlans = loadedSnapshot.planInstances
      .filter(
        (plan) =>
          isActive(plan) &&
          plan.recurringRuleId === rule.id &&
          plan.status === "scheduled" &&
          isOnOrAfter(plan.expectedDate, asOfDate)
      )
      .map((plan) => ({ ...touchRecord(plan), expectedAmountMinor: nextAmountMinor }));

    await saveRecords(
      [
        { storeName: "recurringRules", record: updatedRule },
        { storeName: "subscriptions", record: updatedSubscription },
        ...futurePlans.map((record) => ({ storeName: "planInstances" as const, record }))
      ],
      "subscription price update"
    );
    setMessage(`Subscription price updated. ${futurePlans.length} future plan${futurePlans.length === 1 ? "" : "s"} updated after confirmation.`);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Recurring costs</p>
          <h1>Subscriptions</h1>
        </div>
      </div>

      {message ? <section className="alert-band">{message}</section> : null}

      <SubscriptionForm
        accounts={accounts}
        categories={categories}
        defaultDate={asOfDate}
        onSave={async ({ subscription, rule, plan }) => {
          await saveRecords(
            [
              { storeName: "recurringRules", record: rule },
              { storeName: "subscriptions", record: subscription },
              { storeName: "planInstances", record: plan }
            ],
            "subscription"
          );
          setMessage("Subscription saved with its next planned payment.");
        }}
      />

      <section className="dashboard-band">
        <div className="band-header">
          <div>
            <p className="eyebrow">Tracker</p>
            <h2>Upcoming subscription payments</h2>
          </div>
        </div>
        <div className="data-table subscription-table">
          <div className="data-row header">
            <span>Provider</span>
            <span>Frequency</span>
            <span>Next payment</span>
            <span>Annual renewal</span>
            <span>Amount</span>
            <span>Status</span>
            <span>Action</span>
          </div>
          {subscriptions.map((subscription) => {
            const rule = rulesById.get(subscription.recurringRuleId);
            const paymentSoon = isOnOrBefore(subscription.nextPaymentDate, addDays(asOfDate, 7));
            const annualSoon = subscription.annualRenewalDate
              ? isOnOrBefore(subscription.annualRenewalDate, addDays(asOfDate, 30))
              : false;
            return (
              <div className="data-row" key={subscription.id}>
                <span>
                  <strong>{subscription.provider}</strong>
                  <small>{subscription.essential ? "essential" : "optional"}</small>
                </span>
                <span>{subscription.billingFrequency}</span>
                <span>{formatDisplayDate(subscription.nextPaymentDate)}</span>
                <span>{subscription.annualRenewalDate ? formatDisplayDate(subscription.annualRenewalDate) : "Not set"}</span>
                <Amount value={rule?.amountMinor ?? 0} />
                <span>{paymentSoon ? "Due within seven days" : annualSoon ? "Renewal within 30 days" : "Scheduled"}</span>
                <span>
                  {rule ? (
                    <SubscriptionPriceUpdateForm
                      currentAmountMinor={rule.amountMinor}
                      historyCount={parsePriceHistory(subscription).length}
                      onUpdate={(nextAmountMinor) => updateSubscriptionPrice(subscription, rule, nextAmountMinor)}
                    />
                  ) : (
                    "Missing rule"
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function SubscriptionPriceUpdateForm({
  currentAmountMinor,
  historyCount,
  onUpdate
}: {
  currentAmountMinor: number;
  historyCount: number;
  onUpdate: (amountMinor: number) => Promise<void>;
}) {
  const [amount, setAmount] = useState((currentAmountMinor / 100).toFixed(2));
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (!confirmed) {
        throw new Error("Confirm before updating future plans");
      }
      await onUpdate(parseMoneyInput(amount));
      setConfirmed(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update price");
    }
  }

  return (
    <form className="inline-form price-update-form" onSubmit={submit}>
      <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" aria-label="New subscription price" />
      <label className="checkbox-label compact">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        Future plans
      </label>
      <button className="secondary-action" type="submit">
        Update
      </button>
      <small>{historyCount} prior price change{historyCount === 1 ? "" : "s"}</small>
      {error ? <small className="form-error">{error}</small> : null}
    </form>
  );
}

function parsePriceHistory(subscription: Subscription): SubscriptionPriceHistoryEntry[] {
  if (!subscription.priceHistoryJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(subscription.priceHistoryJson) as SubscriptionPriceHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function SubscriptionForm({
  accounts,
  categories,
  defaultDate,
  onSave
}: {
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  defaultDate: string;
  onSave: (records: { subscription: Subscription; rule: RecurringRule; plan: PlanInstance }) => Promise<void>;
}) {
  const [provider, setProvider] = useState("");
  const [amount, setAmount] = useState("");
  const [nextPaymentDate, setNextPaymentDate] = useState(defaultDate);
  const [annualRenewalDate, setAnnualRenewalDate] = useState("");
  const [billingFrequency, setBillingFrequency] = useState<Subscription["billingFrequency"]>("monthly");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [essential, setEssential] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const amountMinor = parseMoneyInput(amount);
      const rule: RecurringRule = {
        ...createRecordMeta("rule"),
        name: provider,
        kind: "subscription",
        frequency: billingFrequency === "custom" ? "monthly" : billingFrequency,
        interval: 1,
        startDate: nextPaymentDate as RecurringRule["startDate"],
        dayOfMonth: Number.parseInt(nextPaymentDate.slice(-2), 10),
        amountMode: "fixed",
        amountMinor,
        fromAccountId: accountId,
        categoryId,
        essential,
        active: true
      };
      const subscription: Subscription = {
        ...createRecordMeta("sub"),
        recurringRuleId: rule.id,
        provider,
        billingFrequency,
        nextPaymentDate: nextPaymentDate as Subscription["nextPaymentDate"],
        annualRenewalDate: annualRenewalDate ? (annualRenewalDate as Subscription["annualRenewalDate"]) : undefined,
        essential,
        notes: undefined
      };
      const plan: PlanInstance = {
        ...createRecordMeta("plan"),
        recurringRuleId: rule.id,
        kind: "expense",
        name: provider,
        expectedDate: subscription.nextPaymentDate,
        expectedAmountMinor: amountMinor,
        confidence: "expected",
        reservation: "reserved",
        status: "scheduled",
        categoryId,
        accountId,
        essential
      };
      await onSave({ subscription, rule, plan });
      setProvider("");
      setAmount("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save subscription");
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">New</p>
          <h2>Subscription</h2>
        </div>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label className="span-2">
          Provider
          <input value={provider} onChange={(event) => setProvider(event.target.value)} required />
        </label>
        <label>
          Amount
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
        </label>
        <label>
          Frequency
          <select value={billingFrequency} onChange={(event) => setBillingFrequency(event.target.value as Subscription["billingFrequency"])}>
            <option value="monthly">monthly</option>
            <option value="quarterly">quarterly</option>
            <option value="yearly">yearly</option>
            <option value="weekly">weekly</option>
          </select>
        </label>
        <label>
          Next payment
          <input type="date" value={nextPaymentDate} onChange={(event) => setNextPaymentDate(event.target.value)} required />
        </label>
        <label>
          Annual renewal
          <input type="date" value={annualRenewalDate} onChange={(event) => setAnnualRenewalDate(event.target.value)} />
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
        <label className="checkbox-label">
          <input type="checkbox" checked={essential} onChange={(event) => setEssential(event.target.checked)} />
          Essential
        </label>
        {error ? <p className="form-error span-3">{error}</p> : null}
        <div className="form-actions span-3">
          <button className="primary-action" type="submit">
            <Plus size={16} aria-hidden="true" />
            Save subscription
          </button>
        </div>
      </form>
    </section>
  );
}
