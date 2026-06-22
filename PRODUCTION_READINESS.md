# Bluehour Production Readiness

Last updated: 22/06/2026

## Release Candidate Status

Bluehour is prepared as `1.0.0-rc.1` when the automated verification suite below passes on the release-candidate files.

This is not a stable `1.0.0` release. Real Google OAuth, real Drive app-data vault sync, optional Sheet export verification, and GitHub Pages deployment remain manual release gates for stable production use.

## Budget Coach Status

Budget Coach remains local-only browser guidance and is covered by the automated verification suite listed below.

Budget Coach is deterministic, explainable, and local-only. It guides first-cycle onboarding, remains available in Budgets and Review, detects constrained budgets, excludes possible variable income from base budgets, applies Flexible/Balanced/Secure protected-rate profiles, reserves the safety buffer as unallocated cash, and improves confidence with completed-cycle medians.

The local verification attempt on 22/06/2026 passed lint, unit tests, coverage, typecheck, build, and the full Playwright suite with Chromium, WebKit, and mobile-scoped coverage.

## Google Drive Vault Status

Google-only browser login and Drive app-data vault synchronisation have been added and passed the automated verification suite listed below.

The implementation adds Google Sign-In profile metadata, memory-only access tokens, a hidden Drive app-data vault with manifest-last staged writes, profile-ID merge blocking, Settings Drive vault controls, local-only onboarding status, and optional Google Sheet export for inspection. It still requires real Google laptop-to-desktop verification before stable production use.

## Verified Automated Gates

These commands were run locally from a clean dependency install during this pass:

- `npm ci`: passed, 262 packages installed, 0 vulnerabilities.
- `npm run lint`: passed.
- `npm test`: passed, 27 test files and 142 tests.
- `npm run test:coverage`: passed, 82.13% statements, 71.1% branches, 88.19% functions, 81.88% lines.
- `npm run typecheck`: passed.
- `npm run build`: passed, no Vite main-chunk warning; route-level lazy loading keeps the main app chunk at 368.94 kB.
- `npm run test:e2e`: passed, 51 browser tests and 72 intentional project skips across Chromium, WebKit, and mobile-scoped coverage.

## Completed In `1.0.0-rc.1`

- [x] Centralised cross-salary projection into explicit forecast segments.
- [x] Assigned payday only to the future salary cycle.
- [x] Ensured the current segment ends on the day before payday.
- [x] Counted projected main salary exactly once as the virtual future-cycle opening income.
- [x] Counted payday expenses, subscriptions, and confirmed income exactly once.
- [x] Excluded possible payday income while preserving it in the explanatory breakdown.
- [x] Added month-end, leap-year, and early-holiday salary-boundary tests.
- [x] Added a reserve-aware domain cash-flow projection engine.
- [x] Included committed payments, subscriptions, essential dated plans, deterministic undated essential distributions, discretionary reserved plans, projected income, and protected reserve assumptions.
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
- [x] Added `importRowAudits` to IndexedDB, validated snapshots, encrypted backup/restore, Google Sheet serialisation, and sync conflict data.
- [x] Incremented IndexedDB schema to v4 with a non-destructive upgrade path.
- [x] Incremented Google Sheet schema to v3 while keeping v1 and v2 readable as migration sources.
- [x] Preserved staged Google remote writes with inactive-slot writes, full read-back, runtime validation, round-trip comparison, and commit metadata written last.
- [x] Added mocked Google schema round-trip and migration-source tests for the audit model.
- [x] Added Google Sign-In profile metadata with Drive app-data scope and no persisted OAuth tokens.
- [x] Added hidden Drive vault files for `bluehour-manifest.json`, `bluehour-slot-A.json`, and `bluehour-slot-B.json`.
- [x] Refactored the sync planner around provider-neutral remote snapshots while keeping Google Sheets as optional export/inspection.
- [x] Added mocked Drive vault tests for staged writes, unsupported-schema recovery, profile restore, and browser login flows.
- [x] Added WebKit critical-flow coverage while retaining Chromium coverage.
- [x] Updated GitHub Actions to install Chromium and WebKit Playwright browsers.
- [x] Added `CHANGELOG.md`, `docs/RC_CHECKLIST.md`, and refreshed architecture, data model, Google sync, security, recovery, and README documentation.
- [x] Displayed the application version in Settings/About.

## External Manual Release Gate

The only expected unchecked stable-release gate is real external Google verification. It must be completed from the deployed site with a real Google account before Bluehour is labelled stable `1.0.0`.

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
