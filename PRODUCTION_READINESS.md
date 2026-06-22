# Bluehour Production Readiness

Last updated: 22/06/2026

## Release Candidate Status

Bluehour is prepared as `1.0.0-rc.1` when the automated verification suite below passes on the release-candidate files.

This is not a stable `1.0.0` release. Real Google OAuth, real private Sheet sync, Safari Add-to-Dock, and GitHub Pages deployment remain manual release gates for stable production use.

## Unreleased Budget Coach Work

Budget Coach has been added in the working tree but is not promoted to `1.0.0-rc.2` until every automated gate passes.

Budget Coach is deterministic, explainable, and local-only. It guides first-cycle onboarding, remains available in Budgets and Review, detects constrained budgets, excludes possible variable income from base budgets, applies Flexible/Balanced/Secure protected-rate profiles, reserves the safety buffer as unallocated cash, and improves confidence with completed-cycle medians.

The local verification attempt on 22/06/2026 passed lint, unit tests, typecheck, build, and Chromium Playwright coverage. Full `npm run test:e2e` could not pass in this host because WebKit browser dependencies are missing and this environment does not provide `sudo` or `apt-get` to install them.

## Unreleased Cross-Device Recovery Work

Safe cross-device recovery and synchronisation have been added in the working tree but are not promoted to the next RC until every automated gate passes.

The implementation adds a typed synced profile manifest, a local-only random device identity, a Continue-from-existing-Sheet wizard, stale remote-revision checks before push, profile-ID merge blocking, Settings cross-device controls, local-only onboarding status, and guarded legacy Sheet inspection. It still requires real Google laptop-to-desktop verification before stable production use.

## Verified Automated Gates

These commands were run locally from a clean dependency install during the RC pass:

- `npm ci`: passed, 262 packages installed, 0 vulnerabilities.
- `npm run lint`: passed.
- `npm test`: passed, 21 test files and 87 tests.
- `npm run test:coverage`: passed, 85.6% statements, 75.46% branches, 91.66% functions, 85.33% lines.
- `npm run typecheck`: passed.
- `npm run build`: passed, no Vite main-chunk warning; route-level lazy loading keeps the main app chunk at 359.76 kB.
- `npm run test:e2e`: passed, 47 browser tests and 70 intentional project skips across Chromium, WebKit, and mobile-scoped coverage.

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
- [x] Preserved the staged Google A/B-slot write protocol with inactive-slot writes, full read-back, runtime validation, round-trip comparison, and `Meta.activeSlot` last.
- [x] Added mocked Google schema round-trip and migration-source tests for the audit model.
- [x] Added WebKit critical-flow coverage while retaining Chromium coverage.
- [x] Updated GitHub Actions to install Chromium and WebKit Playwright browsers.
- [x] Added `CHANGELOG.md`, `docs/RC_CHECKLIST.md`, and refreshed architecture, data model, Google sync, security, recovery, and README documentation.
- [x] Displayed the application version in Settings/About.

## External Manual Release Gate

The only expected unchecked stable-release gate is real external Google verification. It must be completed from the deployed site with a real Google account before Bluehour is labelled stable `1.0.0`.

The required manual checklist is in `docs/RC_CHECKLIST.md` and includes:

- Configure `VITE_GOOGLE_CLIENT_ID` in GitHub repository variables.
- Enable Google Sheets API and Google Drive API in the Google Cloud project.
- Configure the authorised JavaScript origin in Google Cloud.
- Deploy GitHub Pages.
- Open the deployed app in Safari and add it to the Dock.
- Create a live profile with no fictional data.
- Create and verify a private Bluehour Google Sheet.
- Confirm inactive-slot writes, `Meta.activeSlot` last, reload/pull, offline outbox, reconnection, conflicts, v1 migration-source reads, encrypted backup restore, and no persisted OAuth token.

## Stable `1.0.0` Rule

Do not create a stable `1.0.0` release until the manual Google/Safari/GitHub Pages checklist has been completed and recorded with observed results.
