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
import type { CashFlowProjection, ProjectedCashEvent, ProjectedCashFlowDay } from "../../domain/forecasting/cashFlowProjection";
import type { SafeToSpendPeriod, SafeToSpendResult } from "../../domain/forecasting/safeToSpend";
import { isActive, type BluehourSnapshot, type IsoDate } from "../../domain/types";
import { Amount } from "../../ui/Amount";
import { BreakdownDrawer } from "./BreakdownDrawer";
import { buildBudgetRows, type DashboardBudgetRow } from "./budgetRows";
import { buildDashboardModel } from "./dashboardModel";
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
  const budgetFocusRows = buildBudgetFocusRows(budgetRows);
  const cashPlanLines = buildCashPlanLines(result);
  const cashPath = buildCashPath(model.periods.next30Days.cashFlow);

  const upcoming = projected.breakdown.committedPlans.slice(0, 4);
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
        <MetricCard icon={<Wallet size={19} />} label="Cash now" value={result.netSpendableBalanceMinor} onClick={() => setBreakdownOpen(true)} />
        <MetricCard
          icon={<CalendarClock size={19} />}
          label="Bills reserved"
          value={result.committedReserveMinor + result.essentialEnvelopeReserveMinor}
          onClick={() => setBreakdownOpen(true)}
        />
        <MetricCard icon={<ShieldCheck size={19} />} label="Safety buffer" value={result.bufferReserveMinor} onClick={() => setBreakdownOpen(true)} />
        <MetricCard icon={<TrendingDown size={19} />} label="Lowest balance" value={cashFlow.lowestProjectedBalanceMinor} onClick={() => setBreakdownOpen(true)} />
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

      <section className="overview-grid">
        <div className="dashboard-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">Cash answer</p>
              <h2>Why this number</h2>
            </div>
            <button className="secondary-action" type="button" onClick={() => setBreakdownOpen(true)}>
              Breakdown
            </button>
          </div>
          <div className="cash-plan-list">
            {cashPlanLines.map((line) => (
              <div className={`cash-plan-row${line.level ? ` ${line.level}` : ""}`} key={line.id}>
                <span>
                  <strong>{line.label}</strong>
                  <small>{line.detail}</small>
                </span>
                <Amount value={line.valueMinor} className="cash-plan-value" />
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">Next 30 days</p>
              <h2>Cash path</h2>
            </div>
          </div>
          <div className="cash-path-list">
            {cashPath.map((point) => (
              <div className={`cash-path-row${point.isLowest ? " lowest" : ""}${point.isBelowBuffer ? " warning" : ""}`} key={point.date}>
                <span className="cash-path-date">
                  <strong>{formatDisplayDate(point.date)}</strong>
                  <small>{point.labels.join(" · ")}</small>
                </span>
                <span className="cash-path-balance">
                  <Amount value={point.balanceMinor} className="cash-path-amount" />
                  {point.isLowest ? <small>lowest</small> : point.isBelowBuffer ? <small>below buffer</small> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="two-column">
        <div className="dashboard-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">Budgets</p>
              <h2>Budget focus</h2>
            </div>
            <a className="secondary-action" href="#/budgets">
              Open Budgets
            </a>
          </div>
          <div className="budget-list">
            {budgetFocusRows.length > 0 ? (
              budgetFocusRows.map((row) => (
                <div className="budget-row" key={row.categoryId}>
                  <div>
                    <span>
                      <strong>{row.categoryName}</strong>
                      <small>{stateLabel(row.state)}</small>
                    </span>
                    <span className="budget-row-meta">
                      Allocated <Amount value={row.allocationMinor} /> · Spent <Amount value={row.spentMinor} /> · Reserved{" "}
                      <Amount value={row.reservedFuturePlansMinor} /> · Remaining <Amount value={row.remainingAfterFuturePlansMinor} />
                    </span>
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
              ))
            ) : (
              <div className="stack-row">
                <span>
                  <strong>No active budget pressure</strong>
                  <small>No category has spend, reserves, or allocation in this cycle.</small>
                </span>
              </div>
            )}
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
            {upcoming.length > 0 ? (
              upcoming.map((plan) => (
                <div className="upcoming-row" key={plan.id}>
                  <div>
                    <strong>{plan.label}</strong>
                    <span>{plan.date ? formatDisplayDate(plan.date) : ""}</span>
                  </div>
                  <Amount value={plan.amountMinor} />
                </div>
              ))
            ) : (
              <div className="stack-row">
                <span>
                  <strong>No scheduled payments</strong>
                  <small>No committed payments are reserved in this period.</small>
                </span>
              </div>
            )}
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

interface CashPlanLine {
  id: string;
  label: string;
  detail: string;
  valueMinor: number;
  level?: "result" | "danger";
}

interface CashPathPoint {
  date: IsoDate;
  balanceMinor: number;
  labels: string[];
  isLowest: boolean;
  isBelowBuffer: boolean;
}

function buildCashPlanLines(result: SafeToSpendResult): CashPlanLine[] {
  const lines: CashPlanLine[] = [
    {
      id: "cash-now",
      label: "Cash now",
      detail: "Spendable balance before future income",
      valueMinor: result.netSpendableBalanceMinor
    }
  ];

  if (result.countedFutureIncomeMinor > 0) {
    lines.push({
      id: "future-income",
      label: "Confirmed income",
      detail: "Income counted in this view",
      valueMinor: result.countedFutureIncomeMinor
    });
  }

  lines.push(
    {
      id: "bills-essentials",
      label: "Bills and essentials",
      detail: "Committed payments plus envelope reserves",
      valueMinor: result.committedReserveMinor + result.essentialEnvelopeReserveMinor
    },
    {
      id: "protected",
      label: "Protected savings",
      detail: "Cycle contribution still held aside",
      valueMinor: result.protectedReserveMinor
    },
    {
      id: "buffer",
      label: "Safety buffer",
      detail: "Minimum cash kept untouched",
      valueMinor: result.bufferReserveMinor
    },
    {
      id: "budget-room",
      label: "Budget room",
      detail: "Discretionary budget after spent and planned items",
      valueMinor: result.discretionaryRemainderMinor,
      level: result.discretionaryRemainderMinor < 0 ? "danger" : undefined
    },
    result.shortfallMinor > 0
      ? {
          id: "shortfall",
          label: "Forecast shortfall",
          detail: "Gap before discretionary spending",
          valueMinor: result.shortfallMinor,
          level: "danger"
        }
      : {
          id: "safe",
          label: "Safe to spend",
          detail: `${result.remainingDays} day${result.remainingDays === 1 ? "" : "s"} in this view`,
          valueMinor: result.safeToSpendMinor,
          level: "result"
        }
  );

  return lines;
}

function buildCashPath(projection: CashFlowProjection, maxPoints = 7): CashPathPoint[] {
  const candidates = projection.days.filter(
    (day) =>
      day.date === projection.asOfDate ||
      day.date === projection.horizonEndDate ||
      day.date === projection.firstBelowBufferDate ||
      day.isLowest ||
      hasVisibleCashEvent(day)
  );
  const ranked = [...(candidates.length > 0 ? candidates : projection.days.slice(0, 1))]
    .sort((left, right) => cashPathScore(right, projection) - cashPathScore(left, projection) || left.date.localeCompare(right.date))
    .slice(0, maxPoints)
    .sort((left, right) => left.date.localeCompare(right.date));

  return ranked.map((day) => ({
    date: day.date,
    balanceMinor: day.balanceMinor,
    labels: cashPathLabels(day),
    isLowest: day.isLowest,
    isBelowBuffer: day.isBelowBuffer
  }));
}

function cashPathScore(day: ProjectedCashFlowDay, projection: CashFlowProjection): number {
  let score = 0;
  if (day.date === projection.asOfDate) {
    score += 1000;
  }
  if (day.events.some((event) => event.kind === "income")) {
    score += 900;
  }
  if (day.isLowest) {
    score += 800;
  }
  if (day.date === projection.firstBelowBufferDate) {
    score += 700;
  }
  if (day.events.some((event) => event.kind === "committed_expense" || event.kind === "essential_plan" || event.kind === "protected_transfer")) {
    score += 500;
  }
  if (day.events.some((event) => event.kind === "discretionary_plan")) {
    score += 300;
  }
  if (day.events.some((event) => event.kind === "internal_transfer")) {
    score += 200;
  }
  if (day.date === projection.horizonEndDate) {
    score += 100;
  }
  return score;
}

function hasVisibleCashEvent(day: ProjectedCashFlowDay): boolean {
  return day.events.some((event) => event.kind !== "essential_distribution");
}

function cashPathLabels(day: ProjectedCashFlowDay): string[] {
  const visibleEvents = day.events.filter((event) => event.kind !== "essential_distribution");
  const labels = visibleEvents.slice(0, 2).map(cashEventLabel);
  const hiddenEvents = Math.max(0, visibleEvents.length - labels.length);
  const reserveCategoryCount = new Set(day.events.filter((event) => event.kind === "essential_distribution").map((event) => event.categoryId ?? event.label)).size;

  if (reserveCategoryCount > 0 && labels.length < 2) {
    labels.push(reserveCategoryCount === 1 ? "Essential reserve" : `${reserveCategoryCount} essential reserves`);
  }

  if (hiddenEvents > 0) {
    labels.push(`+${hiddenEvents} more`);
  }

  if (day.isLowest) {
    labels.push("Lowest projected balance");
  } else if (day.isBelowBuffer) {
    labels.push("Below safety buffer");
  }

  if (labels.length === 0) {
    return ["Projected balance"];
  }

  if (labels.length <= 3) {
    return labels;
  }

  return [labels[0], labels[1], `+${labels.length - 2} more`];
}

function cashEventLabel(event: ProjectedCashEvent): string {
  if (!event.isAssumption || /\bassumed\b/i.test(event.label)) {
    return event.label;
  }
  return `${event.label} (assumed)`;
}

const budgetStateRank: Record<DashboardBudgetRow["state"], number> = {
  overspent: 0,
  near_limit: 1,
  fully_reserved: 2,
  no_allocation: 3,
  on_track: 4
};

function buildBudgetFocusRows(rows: readonly DashboardBudgetRow[], maxRows = 4): DashboardBudgetRow[] {
  return [...rows]
    .filter(
      (row) =>
        row.allocationMinor > 0 ||
        row.spentMinor > 0 ||
        row.reservedFuturePlansMinor > 0 ||
        row.remainingAfterFuturePlansMinor < 0
    )
    .sort(
      (left, right) =>
        budgetStateRank[left.state] - budgetStateRank[right.state] ||
        right.percentageUsedOrReserved - left.percentageUsedOrReserved ||
        left.remainingAfterFuturePlansMinor - right.remainingAfterFuturePlansMinor ||
        left.categoryName.localeCompare(right.categoryName)
    )
    .slice(0, maxRows);
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
