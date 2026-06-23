# Savings Coach

Savings Coach is local-only educational planning guidance for salary-cycle savings. It is not financial advice and it does not call external APIs, analytics, telemetry, merchant enrichment, subscription, or AI services.

## User Surfaces

- Primary route: `Coach` at `/coach`.
- Overview: at most two restrained Savings Coach nudges.
- Budgets: read-only Save-the-Difference opportunities with a link to Coach.
- Review: daily tasks for pending savings contributions, active coach insights, and Save-the-Difference opportunities.
- Settings: preferences, merchant watchlist, category reduction targets, snooze window, and reset insight decisions.
- Subscriptions: value rating, last reviewed date, and active/paused/archived review state.

## Workflows

1. Spending Leak Detector
   - Uses shared budget progress, transaction splits, merchant descriptions, subscriptions, recurring rules, extra-income allocations, and saved insight decisions.
   - Produces deterministic insights for category pacing, cycle increases, small purchase clusters, merchant concentration, watchlist merchants, subscription reviews, new recurring costs, and extra-income spend-through.

2. Can I Buy This?
   - Evaluates an intended purchase against safe-to-spend and the selected category's remaining allocation after reserved plans.
   - Persists a `PurchaseCheck` only after the user runs the check.
   - Buying, waiting, or planning remains an explicit follow-up action.

3. Savings Goals
   - Stores `SavingsGoal` records and `SavingsGoalContribution` records.
   - Pending protected contributions are not counted as completed goal progress.
   - Pending protected savings reduce safe-to-spend until the protected transfer is recorded or linked.

4. Save-the-Difference
   - Finds discretionary envelope categories that are under pace after future reserved plans.
   - Suggests integer-sen amounts and leaves a category floor.
   - Creates only pending goal contributions, never bank transfers or budget cuts.

5. Subscription Optimiser
   - Extends subscription review metadata with value rating, last reviewed date, and active/paused/archived state.
   - Cash-flow projection ignores paused and archived subscription records.

6. End-of-Cycle Savings Review
   - Summarises protected target, completed protected transfers, pending savings holds, goal gap, overspent categories, and top explicit review suggestions.

## Persisted Records

Savings Coach adds these synced stores:

- `savingsGoals`
- `savingsGoalContributions`
- `coachInsightDecisions`
- `purchaseChecks`

The records are validated by runtime schemas, included in encrypted backups, Drive vault snapshots, optional Google Sheet export, remote sync conflict handling, and recovery snapshot completion.

## Preferences

Savings Coach preferences are stored inside the existing `preferences` setting under `savingsCoach`:

- `enabled`
- `insightSensitivity`
- `smallPurchaseThresholdMinor`
- `smallPurchaseWindowDays`
- `merchantWatchlist`
- `categoryReductionTargets`
- `defaultGoalPriority`
- `saveDifferenceDefault`
- `snoozeDays`

Insight decisions are archived when reset from Settings. They are not silently deleted.

## Approval Rules

Savings Coach never applies the following automatically:

- Purchases or transaction creation
- Planned purchase creation
- Budget transfers
- Category reduction targets
- Bank or protected-account transfers
- Subscription cancellation or archival
- Savings-goal creation
- Savings-goal contributions
- Insight dismissal, snooze, goal conversion, or plan conversion

Every persisted action is triggered by an explicit UI command.
