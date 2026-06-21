# Bluehour Production Readiness

Last updated: 21/06/2026

## Verified Baseline

- `npm run lint`: passed after implementation.
- `npm run typecheck`: passed after implementation.
- `npm test -- --run`: passed after implementation, 19 files and 72 tests.
- `npm run test:coverage`: passed after implementation, 83.53% statements.
- `npm run build`: passed after implementation; Vite still reports the non-blocking main-chunk size warning.
- `npm run test:e2e`: passed after implementation, 35 executed tests and 27 intentional mobile-project skips for desktop-only scenario/a11y suites.

## Completed In This Pass

- [x] Added cross-salary dashboard projection that creates a virtual next salary cycle when projected month/30-day horizons cross payday.
- [x] Added a deterministic 30-day projected daily cash-flow timeline with event labels and lowest-balance highlighting.
- [x] Added provider-level write guards and route-level handling for `read_only_recovery` and `sync_conflict`.
- [x] Added an export-only read-only recovery screen.
- [x] Added a duplicate open-cycle guard to the first salary-cycle command and hid the Settings first-cycle panel after a cycle exists.
- [x] Replaced fixed onboarding preference defaults with editable setup inputs.
- [x] Added onboarding forms for income plans, obligation plans, and a first-cycle budget template.
- [x] Added plan fulfilment confirmation with editable actual date, amount, account, category, and planned-versus-actual variance display.
- [x] Added CSV file selection, UTF-8 confirmation, column mapping, selectable date format, debit/credit support, reusable import-profile records, and persisted uncertain duplicate review sessions.
- [x] Added categorisation rule historical application for matching uncategorised transactions plus conflict review sessions.
- [x] Added budget-transfer source availability validation and tests.
- [x] Added subscription price-history tracking with explicit confirmation before updating future plan amounts.
- [x] Upgraded Google Sheet staged-write verification from row counts to record round-trip integrity plus runtime schema validation.
- [x] Added an unsupported remote Sheet schema gate that enters read-only recovery.
- [x] Added Settings tooling to prepare missing Google Sheet v2 tabs before push/sync.
- [x] Replaced backup restore mutation writes with a validated atomic profile replacement and explicit restore confirmation.
- [x] Added `AGENTS.md` with project invariants and required commands.
- [x] Replaced the demo-only application entry with explicit app states: `welcome`, `demo`, `setup`, `ready_for_salary`, `live`, `needs_google_reconnection`, `sync_conflict`, and `read_only_recovery`.
- [x] Added a first-launch welcome screen with Explore demonstration and Set up my finances choices.
- [x] Added isolated IndexedDB profile databases: `bluehour-profile-demo` and `bluehour-profile-live`.
- [x] Preserved `bluehour-local` as a legacy database and added tests proving it is not cleared by profile operations.
- [x] Removed production dependency on `DemoDataProvider`.
- [x] Added live/demo clock abstraction. Demo uses a fixed date; live uses the browser-local date.
- [x] Removed hardcoded July 2026 defaults from live forms touched in this pass.
- [x] Added resumable live setup state with Google deferral, preferences, accounts, starter categories, wait-for-salary, and first-cycle start.
- [x] Ensured live profile opens without fictional accounts, transactions, plans, subscriptions, or budgets.
- [x] Ensured demo reset does not alter live data.
- [x] Prevented demo writes from entering the Google sync outbox.
- [x] Disabled Google Sheet descriptor, create, push, and sync actions in demo mode.
- [x] Labelled demo CSV and encrypted-backup downloads as fictional.
- [x] Removed unused Google `userinfo.email` OAuth scope.
- [x] Added staged Google Sheet v2 write protocol using inactive slot writes and `Meta.activeSlot` commit last.
- [x] Updated GitHub Pages manifest/icon links to use Vite base paths.
- [x] Replaced the service worker with network-first navigation and versioned static-asset caching.
- [x] Added PNG PWA icons and Apple touch icon assets.
- [x] Added an update-available shell prompt.
- [x] Added top-level React error boundary.
- [x] Added ESLint, coverage, and Playwright scripts.
- [x] Added Playwright smoke tests for welcome, demo, live setup, demo sync blocking, and mobile More navigation.
- [x] Added the full 25-scenario Playwright production-readiness suite from the task request.
- [x] Added automated axe accessibility audits for major pages and the command dialog.
- [x] Added command-dialog focus management, dialog semantics, and Escape-to-close coverage.
- [x] Fixed accessibility issues found by axe: semantic progress bars, valid labelled regions, and improved color contrast.
- [x] Hardened reconciliation and cycle close: visible reconciliation differences, required notes for differences, persistent cycle-close checklist, reconciliation-or-skip cycle-close guard, category results, protected target summary, and duplicate cycle-close prevention.
- [x] Clarified balance-snapshot boundary behaviour in code and tests so same-day transactions are not double-counted after a snapshot.
- [x] Archived first-cycle setup snapshots for the salary destination account when the real salary boundary is created, preventing salary undercounting after reload.
- [x] Added command-level protection against fulfilling the same planned item twice.
- [x] Added mocked Google v1 single-slot Sheet read coverage as a migration-source path.
- [x] Updated CI to run lint, tests, coverage, typecheck, build, and browser tests, and to pass `VITE_GOOGLE_CLIENT_ID` from repository variables.

## Still Not Fully Production-Ready

- [ ] External Google verification is still required with the real deployed OAuth origin and a real Google account: create a private Sheet, prepare v2 tabs, push, sync, and verify a legacy v1 Sheet migration source end to end.

## Final Verification Required Before `1.0.0`

Bluehour must not be labelled production-ready until the unchecked external Google verification is completed. Keep `package.json` below `1.0.0` until then.
