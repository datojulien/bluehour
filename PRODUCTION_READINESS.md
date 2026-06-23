# Bluehour Production Readiness

Last updated: 23/06/2026

## Release Candidate Status

Bluehour is prepared as `1.0.0-rc.3` when the automated verification suite below passes on the release-candidate files.

This is not a stable `1.0.0` release. Real Google OAuth, real Drive app-data vault sync, optional Sheet export verification, and GitHub Pages deployment remain manual release gates for stable production use.

## V1 RC3 Status

RC3 extends the release-candidate track with Savings Coach while preserving the RC manual stable-release gate:

- Drive app-data vault remains the primary live-profile sync path; Google Sheets remain optional export/inspection only.
- IndexedDB schema is v6, demo fixture version is v6, Drive vault schema is v2, and optional Sheet schema is v5.
- Extra-income decisions are durable records and pending protected allocations reduce safe-to-spend until a protected transfer is explicitly linked.
- Pending savings-goal contributions reduce safe-to-spend until the user records or links the protected transfer.
- Savings Coach adds local-only spending leak detection, purchase checks, savings goals, Save-the-Difference, subscription value review, and cycle savings review.
- Category taxonomy reconciliation is non-destructive and the category manager supports create, rename, archive, restore, reorder, and validated mode/group changes.
- Overview and Budgets share exact budget-progress math, including future reserved plans and overspend states.
- Daily Review, Recent Activity, cycle comparison, Savings Coach, and subscription management are backed by domain calculations and browser coverage.

## Verified Automated Gate

These commands were run locally from a clean dependency install during the RC3 pass:

- `npm ci`: passed, 262 packages installed, 0 vulnerabilities.
- `npm run lint`: passed.
- `npm test`: passed, 36 test files and 188 tests.
- `npm run test:coverage`: passed, 75.01% statements, 64.87% branches, 80.89% functions, 74.51% lines.
- `npm run typecheck`: passed.
- `npm run build`: passed, no Vite main-chunk warning; the main index chunk was 404.00 kB (gzip 121.02 kB).
- `npm run test:e2e`: passed, 65 browser tests and 82 intentional project skips across Chromium, WebKit, and mobile-scoped coverage.

## Completed Across The RC Track

- [x] Centralised cross-salary projection into explicit forecast segments.
- [x] Assigned payday only to the future salary cycle.
- [x] Ensured the current segment ends on the day before payday.
- [x] Counted projected main salary exactly once as the virtual future-cycle opening income.
- [x] Counted payday expenses, subscriptions, and confirmed income exactly once.
- [x] Excluded possible payday income while preserving it in the explanatory breakdown.
- [x] Added month-end, leap-year, and early-holiday salary-boundary tests.
- [x] Added a reserve-aware domain cash-flow projection engine.
- [x] Included committed payments, subscriptions, essential dated plans, deterministic undated essential distributions, discretionary reserved plans, projected income, protected reserve assumptions, and pending protected extra-income allocations.
- [x] Treated safety buffer as a threshold, not as a cash movement.
- [x] Evaluated cross-cycle buffers per segment and reported the limiting segment instead of summing buffers.
- [x] Added exact integer-sen reconciliation for projected closing spendable balance.
- [x] Derived transfer impact from account role so spendable-to-spendable and card-payment transfers do not reduce net spendable wealth.
- [x] Added timeline UI for projected balances, assumptions, excluded income, lowest balance, and first date below buffer.
- [x] Fixed import duplicate matching to compare against the existing transaction leg for the imported account.
- [x] Preserved ranked duplicate candidates with transaction IDs, scores, and reasons.
- [x] Added durable `ImportRowAudit` records for created, strong-linked, uncertain, user-linked, ignored, failed, and rolled-back import outcomes.
- [x] Persisted uncertain import candidates across reload and added user decisions to link, create, or ignore.
- [x] Added same-file import warning and deliberate re-import confirmation.
- [x] Changed rollback to archive only transactions created by that import batch while preserving linked pre-existing transactions and audit history.
- [x] Added `importRowAudits` to IndexedDB, validated snapshots, encrypted backup/restore, optional Google Sheet serialisation, and sync conflict data.
- [x] Incremented IndexedDB schema to v6 with non-destructive upgrade paths.
- [x] Incremented Drive vault schema to v2 and optional Google Sheet schema to v5 while keeping older mocked migration sources readable for inspection/export work.
- [x] Preserved staged Google remote writes with inactive-slot writes, full read-back, runtime validation, round-trip comparison, and commit metadata written last.
- [x] Added mocked Google schema round-trip and migration-source tests for the audit and extra-income models.
- [x] Added Google Sign-In profile metadata with Drive app-data scope and no persisted OAuth tokens.
- [x] Added memory-only token reuse for the current tab with a one-hour reconnection gate.
- [x] Added automatic Drive vault sync for queued live changes while the in-memory Google session is active.
- [x] Added hidden Drive vault files for `bluehour-manifest.json`, `bluehour-slot-A.json`, and `bluehour-slot-B.json`.
- [x] Refactored the sync planner around provider-neutral remote snapshots while keeping Google Sheets as optional export/inspection.
- [x] Added mocked Drive vault tests for staged writes, unsupported-schema recovery, profile restore, and browser login flows.
- [x] Added exact budget-progress domain calculations shared by Overview and Budgets.
- [x] Added Savings Coach domain engines, persisted goal/contribution/insight/purchase records, and explicit user-action flows.
- [x] Added category taxonomy reconciliation and category manager workflows.
- [x] Added extra-income allocation, Daily Review, Recent Activity, cycle comparison, and subscription hardening.
- [x] Added WebKit critical-flow coverage while retaining Chromium coverage.
- [x] Updated GitHub Actions to install Chromium and WebKit Playwright browsers.
- [x] Added `CHANGELOG.md`, `docs/RC_CHECKLIST.md`, `docs/V1_ACCEPTANCE.md`, ADR-001, and refreshed architecture, data model, Google sync, security, recovery, and README documentation.
- [x] Displayed the application version in Settings/About.

## External Manual Release Gate

The expected unchecked stable-release gate is real external Google verification. It must be completed from the deployed site with a real Google account before Bluehour is labelled stable `1.0.0`.

The required manual checklist is in `docs/RC_CHECKLIST.md` and includes:

- Configure `VITE_GOOGLE_CLIENT_ID` in GitHub repository variables.
- Enable Google Drive API in the Google Cloud project.
- Enable Google Sheets API only for optional Sheet export verification.
- Configure the authorised JavaScript origin in Google Cloud.
- Deploy GitHub Pages.
- Open the deployed app in Safari and a second browser profile.
- Create a live profile with no fictional data.
- Create and verify a hidden Bluehour Drive app-data vault.
- Confirm inactive-slot writes, `bluehour-manifest.json` last, reload/pull, offline outbox, reconnection, conflicts, optional Sheet export, encrypted backup restore, and no persisted OAuth token.

## Stable `1.0.0` Rule

Do not create a stable `1.0.0` release until the manual Google Drive vault/GitHub Pages checklist has been completed and recorded with observed results.
