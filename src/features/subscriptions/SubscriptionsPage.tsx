import { useMemo, useState, type FormEvent } from "react";
import { Archive, Plus, Save } from "lucide-react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { addDays, formatDisplayDate, isOnOrAfter, isOnOrBefore } from "../../domain/dates";
import { parseMoneyInput } from "../../domain/money";
import { createRecordMeta, touchRecord } from "../../domain/records";
import { monthlyEquivalentMinor } from "../../domain/subscriptions/subscriptionMath";
import type { PlanInstance, RecurringRule, Subscription } from "../../domain/types";
import { isActive } from "../../domain/types";
import { Amount } from "../../ui/Amount";
import type { LocalMutation } from "../../data/local-db/localDb";

interface SubscriptionPriceHistoryEntry {
  changedAt: string;
  effectiveDate: string;
  previousAmountMinor: number;
  nextAmountMinor: number;
}

type SubscriptionReviewStatus = "active" | "paused";

interface SubscriptionDetailsPatch {
  provider: string;
  billingFrequency: Subscription["billingFrequency"];
  startDate: RecurringRule["startDate"];
  nextPaymentDate: Subscription["nextPaymentDate"];
  annualRenewalDate: string;
  cancellationDeadline: string;
  accountId: string;
  categoryId: string;
  essential: boolean;
  valueRating: Subscription["valueRating"];
  status: SubscriptionReviewStatus;
  notes: string;
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

  async function updateSubscriptionDetails(subscription: Subscription, rule: RecurringRule, patch: SubscriptionDetailsPatch) {
    const updatedRule: RecurringRule = {
      ...touchRecord(rule),
      name: patch.provider,
      frequency: patch.billingFrequency === "custom" ? "monthly" : patch.billingFrequency,
      startDate: patch.startDate,
      dayOfMonth: Number.parseInt(patch.nextPaymentDate.slice(-2), 10),
      fromAccountId: patch.accountId,
      categoryId: patch.categoryId,
      essential: patch.essential,
      active: patch.status === "active"
    };
    const updatedSubscription: Subscription = {
      ...touchRecord(subscription),
      provider: patch.provider,
      billingFrequency: patch.billingFrequency,
      nextPaymentDate: patch.nextPaymentDate,
      annualRenewalDate: patch.annualRenewalDate ? (patch.annualRenewalDate as Subscription["annualRenewalDate"]) : undefined,
      cancellationDeadline: patch.cancellationDeadline ? (patch.cancellationDeadline as Subscription["cancellationDeadline"]) : undefined,
      essential: patch.essential,
      valueRating: patch.valueRating,
      status: patch.status,
      lastReviewedOn: asOfDate,
      notes: patch.notes || undefined
    };
    await saveRecords(
      [
        { storeName: "recurringRules", record: updatedRule },
        { storeName: "subscriptions", record: updatedSubscription }
      ],
      "subscription details"
    );
    setMessage("Subscription details saved.");
  }

  async function archiveSubscription(subscription: Subscription, rule: RecurringRule | undefined, archiveFuturePlans: boolean) {
    const now = new Date().toISOString();
    const archivedSubscription: Subscription = { ...touchRecord(subscription), status: "archived", archivedAt: now };
    const mutations: LocalMutation[] = [{ storeName: "subscriptions", record: archivedSubscription }];
    if (rule) {
      mutations.push({ storeName: "recurringRules", record: { ...touchRecord(rule), active: false } });
      if (archiveFuturePlans) {
        loadedSnapshot.planInstances
          .filter((plan) => isActive(plan) && plan.recurringRuleId === rule.id && plan.status === "scheduled" && isOnOrAfter(plan.expectedDate, asOfDate))
          .forEach((plan) => mutations.push({ storeName: "planInstances", record: { ...touchRecord(plan), status: "archived", archivedAt: now } }));
      }
    }
    await saveRecords(mutations, "subscription archive");
    setMessage("Subscription archived. Completed history and price history were preserved.");
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
            const cancellationSoon = subscription.cancellationDeadline
              ? isOnOrBefore(subscription.cancellationDeadline, addDays(asOfDate, 30))
              : false;
            const priceHistory = parsePriceHistory(subscription);
            const priceIncreased = priceHistory.some((entry) => entry.nextAmountMinor > entry.previousAmountMinor);
            const amountMinor = rule?.amountMinor ?? 0;
            const monthly = monthlyEquivalentMinor(amountMinor, subscription.billingFrequency);
            return (
              <div className="data-row" key={subscription.id}>
                <span>
                  <strong>{subscription.provider}</strong>
                  <small>{subscription.essential ? "essential" : "optional"} · {subscription.valueRating ?? "not rated"} · {subscription.notes ?? "No notes"}</small>
                </span>
                <span>{subscription.billingFrequency}</span>
                <span>{formatDisplayDate(subscription.nextPaymentDate)}</span>
                <span>{subscription.annualRenewalDate ? formatDisplayDate(subscription.annualRenewalDate) : "Not set"}</span>
                <span>
                  <Amount value={amountMinor} />
                  <small>
                    Monthly {monthly.estimated ? "estimate " : ""}<Amount value={monthly.monthlyMinor} /> · annual <Amount value={monthly.annualMinor} />
                  </small>
                </span>
                <span>
                  {paymentSoon
                    ? "Due within seven days"
                    : annualSoon
                      ? "Renewal within 30 days"
                      : cancellationSoon
                        ? "Cancellation deadline approaching"
                        : priceIncreased
                          ? "Price increased"
                          : "Scheduled"}
                  <small>
                    {(subscription.status ?? "active")} · reviewed {subscription.lastReviewedOn ? formatDisplayDate(subscription.lastReviewedOn) : "not yet"}
                  </small>
                </span>
                <span>
                  {rule ? (
                    <div className="subscription-actions">
                      <SubscriptionDetailsForm
                        subscription={subscription}
                        rule={rule}
                        accounts={accounts}
                        categories={categories}
                        onSave={(patch) => updateSubscriptionDetails(subscription, rule, patch)}
                      />
                      <SubscriptionPriceUpdateForm
                        currentAmountMinor={rule.amountMinor}
                        historyCount={priceHistory.length}
                        onUpdate={(nextAmountMinor) => updateSubscriptionPrice(subscription, rule, nextAmountMinor)}
                      />
                      <SubscriptionArchiveForm onArchive={(archiveFuturePlans) => archiveSubscription(subscription, rule, archiveFuturePlans)} />
                    </div>
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

function SubscriptionDetailsForm({
  subscription,
  rule,
  accounts,
  categories,
  onSave
}: {
  subscription: Subscription;
  rule: RecurringRule;
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  onSave: (patch: SubscriptionDetailsPatch) => Promise<void>;
}) {
  const [provider, setProvider] = useState(subscription.provider);
  const [billingFrequency, setBillingFrequency] = useState<Subscription["billingFrequency"]>(subscription.billingFrequency);
  const [startDate, setStartDate] = useState(rule.startDate);
  const [nextPaymentDate, setNextPaymentDate] = useState(subscription.nextPaymentDate);
  const [annualRenewalDate, setAnnualRenewalDate] = useState(subscription.annualRenewalDate ?? "");
  const [cancellationDeadline, setCancellationDeadline] = useState(subscription.cancellationDeadline ?? "");
  const [accountId, setAccountId] = useState(rule.fromAccountId ?? accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(rule.categoryId ?? categories[0]?.id ?? "");
  const [essential, setEssential] = useState(subscription.essential);
  const [valueRating, setValueRating] = useState<Subscription["valueRating"]>(subscription.valueRating ?? "useful");
  const [status, setStatus] = useState<SubscriptionReviewStatus>(subscription.status === "paused" ? "paused" : "active");
  const [notes, setNotes] = useState(subscription.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSave({
        provider,
        billingFrequency,
        startDate,
        nextPaymentDate,
        annualRenewalDate,
        cancellationDeadline,
        accountId,
        categoryId,
        essential,
        valueRating,
        status,
        notes
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save subscription details");
    }
  }

  return (
    <form className="inline-form subscription-details-form" onSubmit={submit}>
      <input value={provider} onChange={(event) => setProvider(event.target.value)} aria-label={`${subscription.provider} provider`} />
      <select value={billingFrequency} onChange={(event) => setBillingFrequency(event.target.value as Subscription["billingFrequency"])} aria-label={`${subscription.provider} frequency`}>
        <option value="monthly">monthly</option>
        <option value="quarterly">quarterly</option>
        <option value="yearly">yearly</option>
        <option value="weekly">weekly</option>
        <option value="custom">custom</option>
      </select>
      <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value as RecurringRule["startDate"])} aria-label={`${subscription.provider} start date`} />
      <input type="date" value={nextPaymentDate} onChange={(event) => setNextPaymentDate(event.target.value as Subscription["nextPaymentDate"])} aria-label={`${subscription.provider} next payment`} />
      <input type="date" value={annualRenewalDate} onChange={(event) => setAnnualRenewalDate(event.target.value)} aria-label={`${subscription.provider} annual renewal`} />
      <input type="date" value={cancellationDeadline} onChange={(event) => setCancellationDeadline(event.target.value)} aria-label={`${subscription.provider} cancellation deadline`} />
      <select value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label={`${subscription.provider} payment account`}>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>
      <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} aria-label={`${subscription.provider} category`}>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      <label className="checkbox-label compact">
        <input type="checkbox" checked={essential} onChange={(event) => setEssential(event.target.checked)} />
        Essential
      </label>
      <select value={valueRating} onChange={(event) => setValueRating(event.target.value as Subscription["valueRating"])} aria-label={`${subscription.provider} value rating`}>
        <option value="essential">essential</option>
        <option value="useful">useful</option>
        <option value="maybe">maybe</option>
        <option value="rarely_used">rarely used</option>
      </select>
      <select value={status} onChange={(event) => setStatus(event.target.value as SubscriptionReviewStatus)} aria-label={`${subscription.provider} review status`}>
        <option value="active">active</option>
        <option value="paused">paused</option>
      </select>
      <input value={notes} onChange={(event) => setNotes(event.target.value)} aria-label={`${subscription.provider} notes`} placeholder="Notes" />
      <button className="icon-button" type="submit" aria-label={`Save ${subscription.provider} details`}>
        <Save size={15} aria-hidden="true" />
      </button>
      {error ? <small className="form-error">{error}</small> : null}
    </form>
  );
}

function SubscriptionArchiveForm({ onArchive }: { onArchive: (archiveFuturePlans: boolean) => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false);
  const [archiveFuturePlans, setArchiveFuturePlans] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (!confirmed) {
        throw new Error("Confirm archive/cancel before changing future subscription records");
      }
      await onArchive(archiveFuturePlans);
      setConfirmed(false);
      setArchiveFuturePlans(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not archive subscription");
    }
  }

  return (
    <form className="inline-form subscription-archive-form" onSubmit={submit}>
      <label className="checkbox-label compact">
        <input type="checkbox" checked={archiveFuturePlans} onChange={(event) => setArchiveFuturePlans(event.target.checked)} />
        Archive future plans
      </label>
      <label className="checkbox-label compact">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        Confirm archive
      </label>
      <button className="secondary-action" type="submit">
        <Archive size={14} aria-hidden="true" />
        Archive
      </button>
      {error ? <small className="form-error">{error}</small> : null}
    </form>
  );
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
  const [cancellationDeadline, setCancellationDeadline] = useState("");
  const [billingFrequency, setBillingFrequency] = useState<Subscription["billingFrequency"]>("monthly");
  const [valueRating, setValueRating] = useState<Subscription["valueRating"]>("useful");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [essential, setEssential] = useState(false);
  const [notes, setNotes] = useState("");
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
        cancellationDeadline: cancellationDeadline ? (cancellationDeadline as Subscription["cancellationDeadline"]) : undefined,
        essential,
        valueRating,
        status: "active",
        lastReviewedOn: defaultDate as Subscription["lastReviewedOn"],
        notes: notes || undefined
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
      setNotes("");
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
            <option value="custom">custom</option>
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
          Cancellation deadline
          <input type="date" value={cancellationDeadline} onChange={(event) => setCancellationDeadline(event.target.value)} />
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
        <label>
          Value
          <select value={valueRating} onChange={(event) => setValueRating(event.target.value as Subscription["valueRating"])}>
            <option value="essential">essential</option>
            <option value="useful">useful</option>
            <option value="maybe">maybe</option>
            <option value="rarely_used">rarely used</option>
          </select>
        </label>
        <label className="span-3">
          Notes
          <input value={notes} onChange={(event) => setNotes(event.target.value)} />
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
