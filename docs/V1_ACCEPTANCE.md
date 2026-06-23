# V1 Acceptance

Bluehour is accepted as `1.0.0-rc.3` when the automated gate passes and the manual stable-release gate remains clearly documented as incomplete.

## Automated Code-Complete Gate

- [x] Local install, lint, unit, coverage, typecheck, production build, and Playwright suites pass.
- [x] Overview and Budgets use the same budget-progress domain model with allocated, spent, reserved, remaining, and overspend states.
- [x] Category taxonomy reconciliation is non-destructive and the category manager can create, rename, archive, restore, reorder, and validate category settings.
- [x] Extra non-salary income requires an explicit available/protected/manual/deferred decision; pending protected amounts reduce safe-to-spend until a matching protected transfer is confirmed.
- [x] Daily Review derives persistent checklist items from uncategorised splits, due plans, uncertain imports, deferred extra income, pending savings contributions, Savings Coach insights, sync issues, and projected shortfalls.
- [x] Savings Coach provides local-only spending leak detection, purchase checks, savings goals, Save-the-Difference, subscription value review, and cycle savings review with explicit user approval for every persisted action.
- [x] Recent Activity and cycle comparison are derived from stored records, with first-cycle fallback copy when comparison is not yet meaningful.
- [x] Subscriptions show monthly equivalents, annual totals, renewal/cancellation alerts, value ratings, metadata edits, and safe archive/cancel handling.
- [x] IndexedDB schema is v6, demo fixture version is v6, Drive vault schema is v2, and optional Google Sheet schema is v5.
- [x] Demo and live profiles remain isolated, and demo data never syncs to Google.

## Manual Stable-Release Gate

Stable `1.0.0` is not accepted until `docs/RC_CHECKLIST.md` is completed with a real Google account and deployed GitHub Pages origin. The remaining manual gate includes OAuth setup, live Drive app-data vault observation, cross-browser sync, stale-device rejection, conflict resolution, optional Sheet export, encrypted backup restore, and token-persistence inspection.

- [ ] Deployed GitHub Pages origin verified with the production OAuth client.
- [ ] Real Google OAuth sign-in observed in Safari and a second browser or device.
- [ ] Hidden Drive app-data vault creation and cross-device onboarding handoff verified.
- [ ] Offline edit, reconnection, stale-device rejection, and conflict resolution verified.
- [ ] Encrypted backup restore and optional Sheet export verified with live-profile data.
- [ ] Browser storage inspected to confirm no OAuth token persistence.
- [ ] Safe-to-spend checked against a hand-calculated live fixture.
- [ ] Savings Coach purchase checks and pending goal contributions checked against a hand-calculated live fixture.
