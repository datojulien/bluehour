import { useEffect, useMemo, useState } from "react";
import { Check, RotateCcw, SlidersHorizontal } from "lucide-react";
import {
  BUDGET_COACH_PROFILES,
  recommendBudget,
  type BudgetCoachInput,
  type BudgetCoachPreferences,
  type BudgetCoachProfileId,
  type BudgetCoachResult,
  type BudgetCoachPriority
} from "../../domain/budgets/budgetCoach";
import { formatDisplayDate } from "../../domain/dates";
import { parseMoneyInput } from "../../domain/money";
import type { Category } from "../../domain/types";
import { Amount } from "../../ui/Amount";

const profileOrder: BudgetCoachProfileId[] = ["flexible", "balanced", "secure"];
const priorityOptions: BudgetCoachPriority[] = ["low", "normal", "high"];

export function BudgetCoachPanel({
  title = "Budget Coach",
  input,
  preferences,
  categories,
  canApply = false,
  applyLabel = "Accept all recommendations",
  onPreferencesChange,
  onAcceptAll,
  onAcceptCategory,
  onReturnToIncome,
  onReturnToObligations
}: {
  title?: string;
  input: BudgetCoachInput | null;
  preferences: BudgetCoachPreferences;
  categories: readonly Category[];
  canApply?: boolean;
  applyLabel?: string;
  onPreferencesChange?: (preferences: BudgetCoachPreferences) => Promise<void>;
  onAcceptAll?: (result: BudgetCoachResult, preferences: BudgetCoachPreferences) => Promise<void>;
  onAcceptCategory?: (categoryId: string, result: BudgetCoachResult, preferences: BudgetCoachPreferences) => Promise<void>;
  onReturnToIncome?: () => void;
  onReturnToObligations?: () => void;
}) {
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const [profileId, setProfileId] = useState<BudgetCoachProfileId>(preferences.profileId);
  const [minimums, setMinimums] = useState<Record<string, string>>(moneyTextByEssential(preferences, "minimumMinor"));
  const [comfortable, setComfortable] = useState<Record<string, string>>(moneyTextByEssential(preferences, "comfortableMinor"));
  const [essentialPriorities, setEssentialPriorities] = useState<Record<string, BudgetCoachPriority>>(
    Object.fromEntries(preferences.essentialPreferences.map((preference) => [preference.categoryId, preference.priority]))
  );
  const [discretionaryPriorities, setDiscretionaryPriorities] = useState<Record<string, "disabled" | BudgetCoachPriority>>(
    Object.fromEntries(
      preferences.discretionaryPreferences.map((preference) => [preference.categoryId, preference.enabled ? preference.priority : "disabled"])
    )
  );
  const [confirmShortfall, setConfirmShortfall] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setProfileId(preferences.profileId);
    setMinimums(moneyTextByEssential(preferences, "minimumMinor"));
    setComfortable(moneyTextByEssential(preferences, "comfortableMinor"));
    setEssentialPriorities(Object.fromEntries(preferences.essentialPreferences.map((preference) => [preference.categoryId, preference.priority])));
    setDiscretionaryPriorities(
      Object.fromEntries(
        preferences.discretionaryPreferences.map((preference) => [preference.categoryId, preference.enabled ? preference.priority : "disabled"])
      )
    );
  }, [preferences]);

  const draft = useMemo(
    () => buildDraftPreferences(preferences, profileId, minimums, comfortable, essentialPriorities, discretionaryPriorities),
    [comfortable, discretionaryPriorities, essentialPriorities, minimums, preferences, profileId]
  );
  const result = useMemo(() => {
    if (!input || draft.error || !draft.preferences) {
      return null;
    }

    try {
      return recommendBudget({
        ...input,
        profileId: draft.preferences.profileId,
        essentialPreferences: draft.preferences.essentialPreferences,
        discretionaryPreferences: draft.preferences.discretionaryPreferences
      });
    } catch {
      return null;
    }
  }, [draft, input]);

  if (!input) {
    return (
      <section className="dashboard-band">
        <div className="band-header">
          <div>
            <p className="eyebrow">Budget Coach</p>
            <h2>{title}</h2>
          </div>
        </div>
        <p className="form-note">Add an expected main salary before Budget Coach can prepare a first salary-cycle recommendation.</p>
        {onReturnToIncome ? (
          <div className="form-actions">
            <button className="secondary-action" type="button" onClick={onReturnToIncome}>
              Return to income
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  const displayResult = result;

  async function savePreferences() {
    if (!draft.preferences || draft.error || !onPreferencesChange) {
      return;
    }
    await onPreferencesChange(draft.preferences);
    setStatus("Budget Coach preferences saved.");
  }

  async function acceptAll() {
    if (!displayResult || !draft.preferences || !onAcceptAll) {
      return;
    }
    if (!displayResult.feasible && !confirmShortfall) {
      setStatus("Confirm the constrained budget before accepting the recommendation.");
      return;
    }
    await onAcceptAll(displayResult, draft.preferences);
    setStatus("Budget Coach recommendations accepted.");
  }

  async function acceptCategory(categoryId: string) {
    if (!displayResult || !draft.preferences || !onAcceptCategory) {
      return;
    }
    await onAcceptCategory(categoryId, displayResult, draft.preferences);
    setStatus(`${categoryById.get(categoryId)?.name ?? categoryId} recommendation accepted.`);
  }

  return (
    <section className="dashboard-band budget-coach-panel">
      <div className="band-header">
        <div>
          <p className="eyebrow">Budget Coach</p>
          <h2>{title}</h2>
        </div>
        <span className={`coach-status ${displayResult?.feasible ? "ok" : "danger"}`}>
          {displayResult?.feasible ? "Feasible" : "Shortfall"}
        </span>
      </div>

      <p className="form-note">
        Budget Coach provides educational budgeting guidance based on the figures you enter. It does not provide investment,
        tax, legal, or credit advice.
      </p>

      {status ? <div className="alert-band">{status}</div> : null}
      {draft.error ? <p className="form-error">{draft.error}</p> : null}

      <section className="coach-section">
        <div className="band-header compact">
          <div>
            <p className="eyebrow">Income summary</p>
            <h3>Main salary base</h3>
          </div>
          {onReturnToIncome ? (
            <button className="secondary-action" type="button" onClick={onReturnToIncome}>
              Return to income
            </button>
          ) : null}
        </div>
        <div className="coach-metric-grid">
          <CoachMetric label="Expected or actual main salary" amount={input.salaryMinor} basisPoints={10_000} />
          <CoachMetric
            label="Variable income excluded"
            amount={input.scenarioIncome?.reduce((total, income) => total + income.amountMinor, 0) ?? 0}
            basisPoints={basisPoints(input.salaryMinor, input.scenarioIncome?.reduce((total, income) => total + income.amountMinor, 0) ?? 0)}
          />
        </div>
        {input.cycleStartDate || input.cycleEndDate ? (
          <p className="form-note">
            Salary-cycle basis: {input.cycleStartDate ? formatDisplayDate(input.cycleStartDate) : "not started"} to{" "}
            {input.cycleEndDate ? formatDisplayDate(input.cycleEndDate) : "estimated end"}.
          </p>
        ) : null}
      </section>

      <section className="coach-section">
        <div className="band-header compact">
          <div>
            <p className="eyebrow">Commitment summary</p>
            <h3>Known commitments</h3>
          </div>
          {onReturnToObligations ? (
            <button className="secondary-action" type="button" onClick={onReturnToObligations}>
              Return to obligations
            </button>
          ) : null}
        </div>
        {input.commitments.length > 0 ? (
          <div className="stack-list">
            {input.commitments.map((commitment) => (
              <div className="stack-row" key={commitment.id}>
                <span>
                  <strong>{commitment.label}</strong>
                  <small>
                    {commitment.dueDate ? formatDisplayDate(commitment.dueDate) : "Cycle commitment"} ·{" "}
                    {formatBasisPoints(basisPoints(input.salaryMinor, commitment.amountMinor))}
                  </small>
                </span>
                <Amount value={commitment.amountMinor} />
              </div>
            ))}
          </div>
        ) : (
          <p className="form-note">No fixed commitments have been entered for this cycle.</p>
        )}
        {!input.commitments.some((commitment) => commitment.categoryId?.includes("housing")) ? (
          <p className="form-note danger-text">No housing cost has been entered. Confirm that this is correct before continuing.</p>
        ) : null}
      </section>

      <section className="coach-section">
        <div className="band-header compact">
          <div>
            <p className="eyebrow">Essential estimates</p>
            <h3>Minimum and comfortable amounts</h3>
          </div>
        </div>
        <p className="form-note">
          Minimum means the amount below which this category would be unrealistic. Comfortable means the amount that should normally cover the cycle.
        </p>
        <div className="coach-preference-grid">
          {preferences.essentialPreferences.map((preference) => (
            <div className="coach-preference-row" key={preference.categoryId}>
              <strong>{categoryById.get(preference.categoryId)?.name ?? preference.categoryId}</strong>
              <label>
                Minimum
                <input
                  inputMode="decimal"
                  value={minimums[preference.categoryId] ?? "0.00"}
                  onChange={(event) => setMinimums((current) => ({ ...current, [preference.categoryId]: event.target.value }))}
                />
              </label>
              <label>
                Comfortable
                <input
                  inputMode="decimal"
                  value={comfortable[preference.categoryId] ?? "0.00"}
                  onChange={(event) => setComfortable((current) => ({ ...current, [preference.categoryId]: event.target.value }))}
                />
              </label>
              <label>
                Priority
                <select
                  value={essentialPriorities[preference.categoryId] ?? "normal"}
                  onChange={(event) =>
                    setEssentialPriorities((current) => ({
                      ...current,
                      [preference.categoryId]: event.target.value as BudgetCoachPriority
                    }))
                  }
                >
                  {priorityOptions.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="coach-section">
        <div className="band-header compact">
          <div>
            <p className="eyebrow">Discretionary priorities</p>
            <h3>Available pool distribution</h3>
          </div>
        </div>
        <div className="coach-preference-grid discretionary">
          {preferences.discretionaryPreferences.map((preference) => (
            <label key={preference.categoryId}>
              {categoryById.get(preference.categoryId)?.name ?? preference.categoryId}
              <select
                value={discretionaryPriorities[preference.categoryId] ?? "normal"}
                onChange={(event) =>
                  setDiscretionaryPriorities((current) => ({
                    ...current,
                    [preference.categoryId]: event.target.value as "disabled" | BudgetCoachPriority
                  }))
                }
              >
                <option value="disabled">Disabled</option>
                {priorityOptions.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="form-note">Priority weights are Low 1, Normal 2, High 3. Remainder sen go to the highest-priority eligible category.</p>
      </section>

      <section className="coach-section">
        <div className="band-header compact">
          <div>
            <p className="eyebrow">Profile</p>
            <h3>Select a coaching profile</h3>
          </div>
        </div>
        <div className="coach-profile-grid" role="radiogroup" aria-label="Budget Coach profile">
          {profileOrder.map((profile) => {
            const profileResult =
              draft.preferences && input
                ? recommendBudget({
                    ...input,
                    profileId: profile,
                    essentialPreferences: draft.preferences.essentialPreferences,
                    discretionaryPreferences: draft.preferences.discretionaryPreferences
                  })
                : null;
            return (
              <button
                className={`coach-profile-card${profileId === profile ? " active" : ""}`}
                type="button"
                key={profile}
                role="radio"
                aria-checked={profileId === profile}
                onClick={() => setProfileId(profile)}
              >
                <strong>{BUDGET_COACH_PROFILES[profile].label}</strong>
                <span>{formatBasisPoints(Math.max(BUDGET_COACH_PROFILES[profile].protectedRateBasisPoints, input.configuredMinimumProtectedRateBasisPoints))} protected</span>
                {profileResult ? (
                  <>
                    <small>
                      Protected <Amount value={profileResult.protectedTargetMinor} />
                    </small>
                    <small>
                      Discretionary <Amount value={profileResult.discretionaryMinor} />
                    </small>
                    <small>{profileResult.feasible ? "Feasible" : <>Shortfall <Amount value={profileResult.shortfallMinor} /></>}</small>
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      {displayResult ? (
        <>
          {!displayResult.feasible ? (
            <section className="alert-band danger constrained-confirmation">
              <span>
                Minimum commitments and essential needs exceed main salary by <Amount value={displayResult.shortfallMinor} />. Bluehour cannot
                create a sustainable discretionary budget from the information currently entered.
              </span>
              <label className="checkbox-label compact">
                <input type="checkbox" checked={confirmShortfall} onChange={(event) => setConfirmShortfall(event.target.checked)} />
                Continue with this shortfall
              </label>
            </section>
          ) : null}

          <section className="coach-section">
            <div className="band-header compact">
              <div>
                <p className="eyebrow">Recommendation summary</p>
                <h3>{BUDGET_COACH_PROFILES[displayResult.profileId].label} plan</h3>
              </div>
            </div>
            <div className="coach-allocation-list">
              {displayResult.groupRecommendations.map((group) => (
                <div className="coach-allocation-row" key={group.id}>
                  <span>{group.label}</span>
                  <Amount value={group.amountMinor} />
                  <span>{formatBasisPoints(group.salaryPercentageBasisPoints)}</span>
                  <small>{group.confidence}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="coach-section">
            <div className="band-header compact">
              <div>
                <p className="eyebrow">Resulting category limits</p>
                <h3>Apply only after approval</h3>
              </div>
            </div>
            <div className="data-table coach-table" role="region" aria-label="Budget Coach category recommendations">
              <div className="data-row header">
                <span>Category</span>
                <span>Current</span>
                <span>Suggested</span>
                <span>Difference</span>
                <span>Confidence</span>
                <span>Apply</span>
              </div>
              {displayResult.categoryRecommendations.map((recommendation) => (
                <div className="data-row" key={recommendation.categoryId}>
                  <span>
                    <strong>{categoryById.get(recommendation.categoryId)?.name ?? recommendation.categoryId}</strong>
                    <small>{formatBasisPoints(recommendation.salaryPercentageBasisPoints)} of salary</small>
                  </span>
                  <Amount value={recommendation.currentAmountMinor ?? 0} />
                  <Amount value={recommendation.suggestedAmountMinor} />
                  <Amount value={recommendation.suggestedAmountMinor - (recommendation.currentAmountMinor ?? 0)} />
                  <span>{recommendation.confidence}</span>
                  {canApply && onAcceptCategory ? (
                    <button className="icon-button" type="button" aria-label={`Accept ${categoryById.get(recommendation.categoryId)?.name ?? recommendation.categoryId}`} onClick={() => void acceptCategory(recommendation.categoryId)}>
                      <Check size={15} aria-hidden="true" />
                    </button>
                  ) : (
                    <span>Preview</span>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="coach-section">
            <div className="band-header compact">
              <div>
                <p className="eyebrow">Why these amounts?</p>
                <h3>Structured explanations</h3>
              </div>
            </div>
            <div className="coach-explanation-grid">
              {displayResult.groupRecommendations.map((group) => (
                <div className="coach-explanation" key={group.id}>
                  <strong>{group.label}</strong>
                  {group.explanation.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              ))}
              {displayResult.categoryRecommendations.slice(0, 6).map((recommendation) => (
                <div className="coach-explanation" key={recommendation.categoryId}>
                  <strong>{categoryById.get(recommendation.categoryId)?.name ?? recommendation.categoryId}</strong>
                  {recommendation.explanation.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              ))}
            </div>
            {displayResult.warnings.length > 0 ? (
              <div className="alert-band danger">
                <span>{displayResult.warnings.join(" ")}</span>
              </div>
            ) : null}
          </section>

          <div className="form-actions">
            {onPreferencesChange ? (
              <button className="secondary-action" type="button" onClick={() => void savePreferences()}>
                <SlidersHorizontal size={16} aria-hidden="true" />
                Save coach preferences
              </button>
            ) : null}
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                setProfileId(preferences.profileId);
                setMinimums(moneyTextByEssential(preferences, "minimumMinor"));
                setComfortable(moneyTextByEssential(preferences, "comfortableMinor"));
              }}
            >
              <RotateCcw size={16} aria-hidden="true" />
              Reset suggestion
            </button>
            {canApply && onAcceptAll ? (
              <button className="primary-action" type="button" onClick={() => void acceptAll()} disabled={!displayResult.feasible && !confirmShortfall}>
                <Check size={16} aria-hidden="true" />
                {applyLabel}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function CoachMetric({ label, amount, basisPoints }: { label: string; amount: number; basisPoints: number }) {
  return (
    <div className="coach-metric">
      <span>{label}</span>
      <strong>
        <Amount value={amount} />
      </strong>
      <small>{formatBasisPoints(basisPoints)}</small>
    </div>
  );
}

function buildDraftPreferences(
  preferences: BudgetCoachPreferences,
  profileId: BudgetCoachProfileId,
  minimums: Record<string, string>,
  comfortable: Record<string, string>,
  essentialPriorities: Record<string, BudgetCoachPriority>,
  discretionaryPriorities: Record<string, "disabled" | BudgetCoachPriority>
): { preferences?: BudgetCoachPreferences; error?: string } {
  try {
    const essentialPreferences = preferences.essentialPreferences.map((preference) => {
      const minimumMinor = parseMoneyInput(minimums[preference.categoryId] ?? "0");
      const comfortableMinor = parseMoneyInput(comfortable[preference.categoryId] ?? "0");
      if (comfortableMinor < minimumMinor) {
        throw new Error(`${preference.categoryId} comfortable amount must be at least the minimum`);
      }
      return {
        categoryId: preference.categoryId,
        minimumMinor,
        comfortableMinor,
        priority: essentialPriorities[preference.categoryId] ?? preference.priority
      };
    });

    return {
      preferences: {
        ...preferences,
        profileId,
        essentialPreferences,
        discretionaryPreferences: preferences.discretionaryPreferences.map((preference) => {
          const priority = discretionaryPriorities[preference.categoryId] ?? preference.priority;
          return {
            categoryId: preference.categoryId,
            enabled: priority !== "disabled",
            priority: priority === "disabled" ? preference.priority : priority
          };
        })
      }
    };
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : "Budget Coach preferences are invalid" };
  }
}

function moneyTextByEssential(preferences: BudgetCoachPreferences, key: "minimumMinor" | "comfortableMinor"): Record<string, string> {
  return Object.fromEntries(preferences.essentialPreferences.map((preference) => [preference.categoryId, (preference[key] / 100).toFixed(2)]));
}

function basisPoints(totalMinor: number, amountMinor: number): number {
  if (totalMinor <= 0 || amountMinor <= 0) {
    return 0;
  }
  return Math.floor((amountMinor * 10_000 + Math.floor(totalMinor / 2)) / totalMinor);
}

function formatBasisPoints(basisPointValue: number): string {
  return `${(basisPointValue / 100).toFixed(1)}%`;
}
