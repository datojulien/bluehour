# Changelog

## 1.0.0-rc.4 - 2026-06-23

- Added Profile Health inspection for local and Drive-vault snapshots, including setup/open-cycle mismatches, missing manifests, shell mismatches, multiple open cycles, and unsupported remote schemas.
- Added safe repair actions for the common setup-plus-one-open-cycle state: resume as live without changing financial records, or archive identifiable accidental first-cycle records after confirmation.
- Hardened first salary-cycle persistence so first-cycle records, allocations, manifest lifecycle, outbox state, and shell transition are atomic from the user's perspective.
- Added Google recovery repair for setup-plus-open-cycle Drive vaults, read-only restore for dangerous remote states, and guarded hidden Drive vault reset with stale-revision checks.
- Added visible Profile Health panels in Settings and read-only Recovery plus browser coverage for repair, Drive reset, no-Sheet Google copy, and read-only remote recovery.
- Kept Google Sheets as optional manual export/inspection only; Google Drive app-data vault remains the primary sync store.

## 1.0.0-rc.3 - 2026-06-23

- Added Savings Coach as a primary Coach route with Spending Leak Detector, Can I Buy This?, Savings Goals, Save-the-Difference, Subscription Optimiser, and End-of-Cycle Savings Review.
- Added persisted `SavingsGoal`, `SavingsGoalContribution`, `CoachInsightDecision`, and `PurchaseCheck` records with runtime validation, backup/restore, Drive vault sync, optional Sheet export, and conflict handling.
- Added pending savings-goal contributions to protected reserve calculations so safe-to-spend and projected cash flow hold those amounts until the user records or links the protected transfer.
- Added restrained Savings Coach cues to Overview, Budgets, Review, Settings, and Subscriptions.
- Extended subscription metadata with value rating, last reviewed date, and active/paused/archived review state.
- Incremented IndexedDB schema to v6, demo fixture version to v6, Drive vault schema to v2, and optional Google Sheet schema to v5.
- Added Savings Coach domain tests and updated documentation across the RC readiness set.

## 1.0.0-rc.2 - 2026-06-23

- Added local-only Budget Coach guidance for first-budget onboarding, the Budgets page, Review, and a restrained dashboard shortfall cue.
- Added Flexible, Balanced, and Secure coaching profiles with explainable protected-rate adjustment, constrained-budget detection, safety-buffer reservation, and deterministic priority-weight allocation.
- Added completed-cycle median history, observed/reliable confidence labels, and atomic accept-one or accept-all budget recommendation flows.
- Added Google Sign-In plus a hidden Google Drive app-data vault as the primary browser sync path, with no persisted OAuth tokens.
- Added Drive vault staged writes with inactive-slot validation, manifest-last commit, cross-profile merge blocking, and Settings controls for syncing, exporting the local descriptor, optional Sheet export, and disconnecting one browser.
- Kept Google Sheets as optional manual export/inspection rather than the login or daily sync source.
- Added RC2 category taxonomy reconciliation, category-manager create/rename/archive/restore/reorder flows, and validated category mode/group changes.
- Added exact budget-progress domain calculations shared by Overview and Budgets, including reserved future plans, overspend states, and no hard-coded progress fallbacks.
- Added extra-income allocation records and UI decisions for available/protected/manual/deferred income, including protected-transfer confirmation before safe-to-spend releases pending protected income.
- Added Daily Review task generation for uncategorised splits, due plans, uncertain imports, deferred extra income, sync issues, and projected shortfalls.
- Added real Recent Activity and cycle comparison summaries derived from transactions, plans, transfers, reconciliations, imports, subscriptions, and cycle events.
- Added subscription monthly-equivalent math, cancellation/deadline alerts, metadata editing, and safe archive/cancel flows that preserve historical plans.
- Incremented IndexedDB schema to v5, demo fixture version to v5, and optional Google Sheet schema to v4 for `ExtraIncomeAllocations`.
- Added RC2 unit and Playwright coverage for category management, budget progress, extra income, Daily Review, subscriptions, cycle comparison, and activity feeds.

## 1.0.0-rc.1

- Salary-boundary forecast correction: payday is owned by the future salary cycle, the current projected segment ends the day before payday, projected salary is applied once, and cross-cycle buffers are reported per segment instead of being added together as a cash outflow.
- Full reserve-aware cash-flow projection: the timeline now uses domain-level projected cash events for confirmed income, projected salary, committed plans, subscriptions, essential plans, deterministic undated essential distributions, discretionary reservations, protected-transfer assumptions, and net-spendable transfer impacts.
- Import duplicate audit trail: every normalized CSV row receives a typed audit outcome, strong matches link without creating transactions, uncertain matches persist ranked candidate transaction IDs and scores, and user decisions survive reload.
- RC test and Safari/WebKit hardening: Playwright now includes WebKit critical flows, route-level lazy loading removes the main chunk warning without changing `chunkSizeWarningLimit`, and documentation has been updated for the release-candidate gate.
