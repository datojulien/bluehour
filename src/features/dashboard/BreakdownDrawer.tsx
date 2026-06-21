import { X } from "lucide-react";
import { formatDisplayDate } from "../../domain/dates";
import type { SafeToSpendResult } from "../../domain/forecasting/safeToSpend";
import { Amount } from "../../ui/Amount";

interface BreakdownDrawerProps {
  result: SafeToSpendResult;
  open: boolean;
  onClose: () => void;
}

export function BreakdownDrawer({ result, open, onClose }: BreakdownDrawerProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="breakdown-drawer"
        aria-label="Safe-to-spend breakdown"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Breakdown</p>
            <h2>Safe to spend</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close breakdown" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="drawer-section">
          <h3>Starting balances</h3>
          {result.breakdown.accountBalances.map(({ account, balanceMinor }) => (
            <div className="drawer-row" key={account.id}>
              <span>{account.name}</span>
              <Amount value={balanceMinor} />
            </div>
          ))}
        </div>

        <div className="drawer-section">
          <h3>Reservations</h3>
          <div className="drawer-row strong">
            <span>Committed plans</span>
            <Amount value={result.committedReserveMinor} />
          </div>
          {result.breakdown.committedPlans.map((plan) => (
            <div className="drawer-row muted" key={plan.id}>
              <span>
                {plan.label} · {plan.date ? formatDisplayDate(plan.date) : ""}
              </span>
              <Amount value={plan.amountMinor} />
            </div>
          ))}
          <div className="drawer-row strong">
            <span>Essential envelopes</span>
            <Amount value={result.essentialEnvelopeReserveMinor} />
          </div>
          {result.breakdown.essentialEnvelopeReserves.map((reserve) => (
            <div className="drawer-row muted" key={reserve.id}>
              <span>{reserve.label}</span>
              <Amount value={reserve.amountMinor} />
            </div>
          ))}
          <div className="drawer-row strong">
            <span>Protected contribution remaining</span>
            <Amount value={result.protectedReserveMinor} />
          </div>
          <div className="drawer-row muted">
            <span>Target minus completed transfers</span>
            <span>
              <Amount value={result.breakdown.protectedTargetMinor} /> − <Amount value={result.breakdown.completedProtectedMinor} />
            </span>
          </div>
          <div className="drawer-row strong">
            <span>Safety buffer</span>
            <Amount value={result.bufferReserveMinor} />
          </div>
        </div>

        <div className="drawer-section">
          <h3>Discretionary cap</h3>
          <div className="drawer-row">
            <span>Approved allocations</span>
            <Amount value={result.breakdown.discretionaryAllocationMinor} />
          </div>
          <div className="drawer-row">
            <span>Actual spending</span>
            <Amount value={-result.breakdown.discretionarySpentMinor} />
          </div>
          <div className="drawer-row">
            <span>Reserved future plans</span>
            <Amount value={-result.breakdown.discretionaryReservedPlansMinor} />
          </div>
          <div className="drawer-row strong">
            <span>Discretionary remainder</span>
            <Amount value={result.discretionaryRemainderMinor} />
          </div>
        </div>

        <div className="drawer-section">
          <h3>Income treatment</h3>
          {result.breakdown.includedIncome.map((income) => (
            <div className="drawer-row" key={income.id}>
              <span>
                {income.label} · {income.date ? formatDisplayDate(income.date) : ""}
              </span>
              <Amount value={income.amountMinor} />
            </div>
          ))}
          {result.breakdown.excludedIncome.map((income) => (
            <div className="drawer-row muted" key={income.id}>
              <span>
                {income.label} · excluded
              </span>
              <Amount value={income.amountMinor} />
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
