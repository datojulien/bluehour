# Changelog

## Unreleased

- Added local-only Budget Coach guidance for first-budget onboarding, the Budgets page, Review, and a restrained dashboard shortfall cue.
- Added Flexible, Balanced, and Secure coaching profiles with explainable protected-rate adjustment, constrained-budget detection, safety-buffer reservation, and deterministic priority-weight allocation.
- Added completed-cycle median history, observed/reliable confidence labels, and atomic accept-one or accept-all budget recommendation flows.
- Added Google Sign-In plus a hidden Google Drive app-data vault as the primary browser sync path, with no persisted OAuth tokens.
- Added Drive vault staged writes with inactive-slot validation, manifest-last commit, cross-profile merge blocking, and Settings controls for syncing, exporting the local descriptor, optional Sheet export, and disconnecting one browser.
- Kept Google Sheets as optional manual export/inspection rather than the login or daily sync source.

## 1.0.0-rc.1

- Salary-boundary forecast correction: payday is owned by the future salary cycle, the current projected segment ends the day before payday, projected salary is applied once, and cross-cycle buffers are reported per segment instead of being added together as a cash outflow.
- Full reserve-aware cash-flow projection: the timeline now uses domain-level projected cash events for confirmed income, projected salary, committed plans, subscriptions, essential plans, deterministic undated essential distributions, discretionary reservations, protected-transfer assumptions, and net-spendable transfer impacts.
- Import duplicate audit trail: every normalized CSV row receives a typed audit outcome, strong matches link without creating transactions, uncertain matches persist ranked candidate transaction IDs and scores, and user decisions survive reload.
- RC test and Safari/WebKit hardening: Playwright now includes WebKit critical flows, route-level lazy loading removes the main chunk warning without changing `chunkSizeWarningLimit`, and documentation has been updated for the release-candidate gate.
