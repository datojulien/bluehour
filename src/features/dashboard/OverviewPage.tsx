import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CalendarClock, ChevronRight, PiggyBank, ShieldCheck, TrendingDown, Wallet } from "lucide-react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { buildActivityFeed } from "../../domain/activity/activityFeed";
import { recommendBudget } from "../../domain/budgets/budgetCoach";
import { readSavingsCoachPreferences } from "../../domain/coach/preferences";
import { detectSpendingLeaks } from "../../domain/coach/spendingLeakDetector";
import { compareActiveCycleToPrevious } from "../../domain/reviews/cycleComparison";
import { addDays, formatDisplayDate, isOnOrBefore } from "../../domain/dates";
import type { CashFlowProjection } from "../../domain/forecasting/cashFlowProjection";
import type { SafeToSpendPeriod, SafeToSpendResult } from "../../domain/forecasting/safeToSpend";
import { isActive, type BluehourSnapshot, type IsoDate } from "../../domain/types";
import { Amount } from "../../ui/Amount";
import { BreakdownDrawer } from "./BreakdownDrawer";
import { buildBudgetRows, type DashboardBudgetRow } from "./budgetRows";
import { buildDailyTimeline, buildDashboardModel } from "./dashboardModel";
import { buildBudgetCoachInputForCycle, readBudgetCoachPreferences } from "../budgets/budgetCoachSettings";

const periodOrder: SafeToSpendPeriod[] = ["untilSalary", "thisMonth", "next30Days"];

export function OverviewPage() {
  const { snapshot, asOfDate, loading, error } = useBluehourData();
  const [period, setPeriod] = useState<SafeToSpendPeriod>("untilSalary");
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const model = useMemo(() => (snapshot ? buildDashboardModel(snapshot, asOfDate) : null), [snapshot, asOfDate]);
  const coachCue = useMemo(() => {
    if (!snapshot) {
      return null;
    }

    const activeCycle = snapshot.budgetCycles.find((cycle) => cycle.status === "open");
    if (!activeCycle) {
      return null;
    }

    try {
      const preferences = readBudgetCoachPreferences(snapshot.settings, snapshot.categories);
      return recommendBudget(
        buildBudgetCoachInputForCycle({
          snapshot,
          cycle: activeCycle,
          asOfDate,
          preferences
        })
      );
    } catch {
      return null;
    }
  }, [asOfDate, snapshot]);
  const savingsNudges = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    const activeCycle = snapshot.budgetCycles.find((cycle) => cycle.status === "open");
    if (!activeCycle) {
      return [];
    }
    try {
      return detectSpendingLeaks(snapshot, activeCycle, asOfDate, readSavingsCoachPreferences(snapshot.settings)).slice(0, 2);
    } catch {
      return [];
    }
  }, [asOfDate, snapshot]);

  if (loading) {
    return <div className="loading-state">Opening local profile data...</div>;
  }

  if (error || !model || !snapshot) {
    return (
      <section className="empty-state">
        <h1>Bluehour</h1>
        <p>{error ?? "No open salary cycle is available yet."}</p>
      </section>
    );
  }

  const selected = model.periods[period];
  const result = selected.available;
  const projected = selected.projected;
  const cashFlow = selected.cashFlow;
  const cycle = model.activeCycle;
  const budgetRows = buildBudgetRows(snapshot, cycle, asOfDate);

  const upcoming = projected.breakdown.committedPlans.slice(0, 4);
  const timeline = buildDailyTimeline(model.periods.next30Days.cashFlow, 30);
  const alerts = buildDashboardAlerts(snapshot, result, cashFlow, budgetRows, asOfDate);
  const comparison = compareActiveCycleToPrevious(snapshot, cycle, asOfDate);
  const whatChanged = comparison.items.slice(0, 5);
  const activity = buildActivityFeed(snapshot, 8);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Salary cycle</p>
          <h1>
            {formatDisplayDate(cycle.startedOn)} to {formatDisplayDate(addDays(cycle.expectedNextSalaryTo, -1))}
          </h1>
        </div>
        <div className="date-chip">Today {formatDisplayDate(asOfDate)}</div>
      </div>

      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Safe to spend</p>
          <button className="hero-amount" type="button" onClick={() => setBreakdownOpen(true)}>
            <Amount value={result.safeToSpendMinor} />
            <ChevronRight size={24} aria-hidden="true" />
          </button>
          <div className="hero-subgrid">
            <span>
              <Amount value={result.dailyAmountMinor} /> per day
            </span>
            <span>
              Lowest projected balance <Amount value={cashFlow.lowestProjectedBalanceMinor} /> on{" "}
              {formatDisplayDate(cashFlow.lowestProjectedBalanceDate)}
            </span>
          </div>
        </div>

        <div className="period-control" role="tablist" aria-label="Safe-to-spend period">
          {periodOrder.map((periodKey) => (
            <button
              key={periodKey}
              type="button"
              role="tab"
              aria-selected={period === periodKey}
              className={period === periodKey ? "active" : ""}
              onClick={() => setPeriod(periodKey)}
            >
              {model.periods[periodKey].label}
            </button>
          ))}
        </div>
      </section>

      <section className="metric-grid" aria-label="Safe-to-spend companion values">
        <MetricCard icon={<Wallet size={19} />} label="Available now" value={result.safeToSpendMinor} onClick={() => setBreakdownOpen(true)} />
        <MetricCard icon={<CalendarClock size={19} />} label="Projected" value={projected.safeToSpendMinor} onClick={() => setBreakdownOpen(true)} />
        <MetricCard icon={<ShieldCheck size={19} />} label="Reserved essentials" value={result.committedReserveMinor + result.essentialEnvelopeReserveMinor} onClick={() => setBreakdownOpen(true)} />
        <MetricCard icon={<TrendingDown size={19} />} label="Safety buffer" value={result.bufferReserveMinor} onClick={() => setBreakdownOpen(true)} />
      </section>

      {result.shortfallMinor > 0 ? (
        <section className="alert-band danger">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            Forecast shortfall of <Amount value={result.shortfallMinor} /> before this period ends.
          </span>
        </section>
      ) : result.protectedReserveMinor > 0 ? (
        <section className="alert-band">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            Protected contribution remaining: <Amount value={result.protectedReserveMinor} />.
          </span>
        </section>
      ) : (
        <section className="alert-band">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Protected contribution is complete for this cycle.</span>
        </section>
      )}

      {coachCue && !coachCue.feasible ? (
        <section className="alert-band danger">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            Budget Coach sees a planning shortfall of <Amount value={coachCue.shortfallMinor} /> before discretionary spending.
          </span>
          <a className="secondary-action" href="#/budgets">
            Review with Budget Coach
          </a>
        </section>
      ) : null}

      {savingsNudges.length > 0 ? (
        <section className="alert-band">
          <PiggyBankIcon />
          <span>
            Savings Coach: {savingsNudges.map((nudge) => nudge.title).join(" · ")}
          </span>
          <a className="secondary-action" href="#/coach">
            Open Coach
          </a>
        </section>
      ) : null}

      <section className="dashboard-band">
        <div className="band-header">
          <div>
            <p className="eyebrow">Thirty-day timeline</p>
            <h2>Planned cash movement</h2>
          </div>
        </div>
        <div className="timeline">
          {timeline.map((point) => (
            <div className={`timeline-point${point.isLowest ? " timeline-lowest" : ""}${point.isBelowBuffer ? " timeline-warning" : ""}`} key={point.date}>
              <span className="timeline-dot" aria-hidden="true" />
              <div>
                <strong>{point.labels.length > 0 ? point.labels.join(", ") : "Projected day"}</strong>
                <span>{formatDisplayDate(point.date)}</span>
              </div>
              <Amount value={point.balanceMinor} />
            </div>
          ))}
        </div>
      </section>

      <section className="two-column">
        <div className="dashboard-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">Budgets</p>
              <h2>Cycle progress</h2>
            </div>
          </div>
          <div className="budget-list">
            {budgetRows.map((row) => (
              <div className="budget-row" key={row.categoryId}>
                <div>
                  <strong>{row.categoryName}</strong>
                  <span>
                    Allocated <Amount value={row.allocationMinor} /> · Spent <Amount value={row.spentMinor} /> · Reserved{" "}
                    <Amount value={row.reservedFuturePlansMinor} /> · Remaining <Amount value={row.remainingAfterFuturePlansMinor} />
                  </span>
                  <small>{stateLabel(row.state)}</small>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label={`${row.categoryName} ${row.percentageUsedOrReserved}% used or reserved`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(100, row.percentageUsedOrReserved)}
                >
                  <span style={{ width: `${Math.min(100, row.percentageUsedOrReserved)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">Upcoming</p>
              <h2>Next payments</h2>
            </div>
          </div>
          <div className="upcoming-list">
            {upcoming.map((plan) => (
              <div className="upcoming-row" key={plan.id}>
                <div>
                  <strong>{plan.label}</strong>
                  <span>{plan.date ? formatDisplayDate(plan.date) : ""}</span>
                </div>
                <Amount value={plan.amountMinor} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="two-column">
        <div className="dashboard-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">Alerts</p>
              <h2>Needs attention</h2>
            </div>
          </div>
          <div className="stack-list">
            {alerts.map((alert) => (
              <div className={`stack-row alert-${alert.level}`} key={alert.label}>
                <span>
                  <strong>{alert.label}</strong>
                  <small>{alert.detail}</small>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">What changed?</p>
              <h2>Cycle notes</h2>
            </div>
          </div>
          <div className="stack-list">
            {whatChanged.length > 0 ? (
              whatChanged.map((item) => (
                <div className={`stack-row alert-${item.level}`} key={item.id}>
                  <span>
                    <strong>{item.label}</strong>
                    <small>
                      {item.deltaMinor !== undefined ? <Amount value={item.deltaMinor} /> : null} {item.explanation}
                    </small>
                  </span>
                </div>
              ))
            ) : (
              <div className="stack-row">
                <span>{comparison.unavailableReason ?? "Cycle comparison will be available after another completed cycle."}</span>
              </div>
            )}
            <a className="secondary-action" href="#/review">
              Open Review
            </a>
          </div>
        </div>
      </section>

      <section className="dashboard-band">
        <div className="band-header">
          <div>
            <p className="eyebrow">Recent Activity</p>
            <h2>Real profile events</h2>
          </div>
        </div>
        <div className="stack-list">
          {activity.map((item) => (
            <a className="stack-row activity-row" href={`#${item.route ?? "/"}`} key={item.id}>
              <span>
                <strong>{item.label}</strong>
                <small>
                  {formatDisplayDate(item.localDate)} · {item.detail ?? item.type.replaceAll("_", " ")}
                </small>
              </span>
              {item.amountMinor !== undefined ? <Amount value={item.amountMinor} /> : null}
            </a>
          ))}
        </div>
      </section>

      <BreakdownDrawer result={result} cashFlow={cashFlow} open={breakdownOpen} onClose={() => setBreakdownOpen(false)} />
    </>
  );
}

function PiggyBankIcon() {
  return <PiggyBank size={18} aria-hidden="true" />;
}

function buildDashboardAlerts(
  snapshot: BluehourSnapshot,
  result: SafeToSpendResult,
  cashFlow: CashFlowProjection,
  budgetRows: DashboardBudgetRow[],
  asOfDate: IsoDate
): Array<{ label: string; detail: string; level: "info" | "warning" | "danger" }> {
  const alerts: Array<{ label: string; detail: string; level: "info" | "warning" | "danger" }> = [];
  const dueSoon = snapshot.planInstances.filter(
    (plan) => isActive(plan) && plan.kind !== "income" && plan.status === "scheduled" && isOnOrBefore(plan.expectedDate, addDays(asOfDate, 7))
  );
  const renewalsSoon = snapshot.subscriptions.filter(
    (subscription) => isActive(subscription) && subscription.annualRenewalDate && isOnOrBefore(subscription.annualRenewalDate, addDays(asOfDate, 30))
  );
  const uncategorised = snapshot.transactionSplits.filter((split) => isActive(split) && split.categoryId === "cat-uncategorised").length;
  const waitingToSync = snapshot.outboxOperations.length;
  const overspent = budgetRows.filter((row) => row.state === "overspent");
  const nearLimit = budgetRows.filter((row) => row.state === "near_limit" || row.state === "fully_reserved");

  if (result.safeToSpendMinor === 0) {
    alerts.push({ label: "Safe to spend is RM0.00", detail: "Review discretionary plans and category budgets.", level: "danger" });
  }
  if (cashFlow.firstBelowBufferDate) {
    alerts.push({
      label: "Projected balance below buffer",
      detail: `The cash-flow projection crosses the active segment buffer on ${formatDisplayDate(cashFlow.firstBelowBufferDate)}.`,
      level: "danger"
    });
  }
  if (dueSoon.length > 0) {
    alerts.push({ label: "Payments due within seven days", detail: `${dueSoon.length} planned payment${dueSoon.length === 1 ? "" : "s"} due soon.`, level: "warning" });
  }
  if (renewalsSoon.length > 0) {
    alerts.push({ label: "Annual renewal within 30 days", detail: `${renewalsSoon.length} subscription renewal${renewalsSoon.length === 1 ? "" : "s"} approaching.`, level: "warning" });
  }
  if (overspent.length > 0) {
    alerts.push({ label: "Category overspent", detail: overspent.map((row) => row.categoryName).join(", "), level: "danger" });
  }
  if (nearLimit.length > 0) {
    alerts.push({ label: "Category near limit", detail: nearLimit.map((row) => row.categoryName).join(", "), level: "warning" });
  }
  if (uncategorised > 0) {
    alerts.push({ label: "Uncategorised transactions", detail: `${uncategorised} split${uncategorised === 1 ? "" : "s"} need review.`, level: "warning" });
  }
  if (waitingToSync > 0) {
    alerts.push({ label: "Local changes waiting to sync", detail: `${waitingToSync} outbox operation${waitingToSync === 1 ? "" : "s"} pending.`, level: "info" });
  }

  return alerts.length > 0 ? alerts : [{ label: "No urgent alerts", detail: "The current profile has no urgent forecast warnings.", level: "info" }];
}

function stateLabel(state: DashboardBudgetRow["state"]): string {
  return state.replace("_", " ");
}

function MetricCard({
  icon,
  label,
  value,
  onClick
}: {
  icon: ReactNode;
  label: string;
  value: number;
  onClick: () => void;
}) {
  return (
    <button className="metric-card" type="button" onClick={onClick}>
      <span className="metric-icon">{icon}</span>
      <span>{label}</span>
      <Amount value={value} className="metric-value" />
    </button>
  );
}
