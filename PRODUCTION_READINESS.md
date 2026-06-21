# Bluehour Production Readiness

Last updated: 21/06/2026

## Verified Baseline

- `npm ci`: passed before implementation.
- `npm test`: passed before implementation, 17 files and 50 tests.
- `npm run typecheck`: passed before implementation.
- `npm run build`: passed before implementation.

## Completed In This Pass

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
- [x] Added an update-available shell prompt.
- [x] Added top-level React error boundary.
- [x] Added ESLint, coverage, and Playwright scripts.
- [x] Added Playwright smoke tests for welcome, demo, live setup, demo sync blocking, and mobile More navigation.
- [x] Updated CI to run lint, tests, coverage, typecheck, build, and browser tests, and to pass `VITE_GOOGLE_CLIENT_ID` from repository variables.

## Still Not Fully Production-Ready

- [ ] Full 25-scenario E2E suite from the task request is not complete.
- [ ] Accessibility audit is not automated beyond the current semantic/focus improvements.
- [ ] Cross-salary virtual-cycle forecasting is still incomplete.
- [ ] Deterministic projected daily cash-flow timeline is still limited.
- [ ] Plan fulfilment still needs the full editable confirmation form and variance preservation UI.
- [ ] CSV import is still a prototype textarea flow, not the full reusable mapping wizard.
- [ ] Uncertain duplicate rows are counted but not persisted as reviewable import candidates.
- [ ] Categorisation rule conflict resolution and historical application workflows remain limited.
- [ ] Budget advanced override tests and full source-availability validation remain limited.
- [ ] Subscription price history and confirmation before updating future plans remain incomplete.
- [ ] Reconciliation and cycle-close flows remain useful but not complete against every acceptance item.
- [ ] Google v1 Sheet migration UI is not complete.
- [ ] Real Google OAuth and live Sheet sync were not verified against a real Google account.
- [ ] Backup restore is not yet a fully staged atomic replacement with profile-type warnings.
- [ ] PNG PWA icons and Apple touch PNG are not yet generated.

## Final Verification Required Before `1.0.0`

Bluehour must not be labelled production-ready until all unchecked items above are implemented and tested. Keep `package.json` below `1.0.0` until then.
