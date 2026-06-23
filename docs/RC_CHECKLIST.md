# Bluehour Release Candidate Manual Checklist

This checklist is release-blocking for stable `1.0.0`. It is not claimed complete for the RC unless each item is manually performed and observed with a real Google account and the deployed app.

## Automated Gate Before `1.0.0-rc.4`

- [x] `npm ci` passed, 262 packages installed, 0 vulnerabilities.
- [x] `npm run lint` passed.
- [x] `npm test` passed, 37 test files and 213 tests.
- [x] `npm run test:coverage` passed, 75.32% statements, 66.51% branches, 80.98% functions, 74.77% lines.
- [x] `npm run typecheck` passed.
- [x] `npm run build` passed, no Vite main-chunk warning; main index chunk 411.94 kB (gzip 122.98 kB).
- [x] `npm run test:e2e` passed, 78 browser tests and 90 intentional project skips.

Budget Coach, Savings Coach, Profile Health and Repair, Drive vault sync mocks, category management, budget progress, extra income, Daily Review, subscriptions, Recent Activity, and cycle comparison are covered by the automated gate above; stable release still depends on the manual gate below.

Google Drive vault automated coverage uses mocked Google Identity and Drive responses; real Google OAuth and deployed-origin verification remain manual gates.

## External Manual Gate Before Stable `1.0.0`

- [ ] Configure `VITE_GOOGLE_CLIENT_ID` in GitHub repository variables.
- [ ] Enable Google Drive API in the Google Cloud project.
- [ ] Enable Google Sheets API only if optional Sheet export will be validated.
- [ ] Configure the authorised JavaScript origin in Google Cloud.
- [ ] Deploy GitHub Pages.
- [ ] Open the deployed app in Safari.
- [ ] Open the deployed app in at least one second browser profile.
- [ ] Create a live profile containing no fictional data.
- [ ] Create or load the hidden Google Drive app-data vault.
- [ ] Confirm the app-data folder contains `bluehour-manifest.json`, `bluehour-slot-A.json`, and `bluehour-slot-B.json`.
- [ ] Push the live profile to the Drive vault.
- [ ] Confirm only the inactive slot file was written before commit.
- [ ] Confirm `bluehour-manifest.json` changed last.
- [ ] Reload and pull the same data.
- [ ] Make an offline transaction and confirm it enters the outbox.
- [ ] Reconnect and sync.
- [ ] Test token expiration/reconnection.
- [ ] Test a local/remote conflict using two browser profiles.
- [ ] Resolve the conflict explicitly.
- [ ] Export a Google Sheet for inspection.
- [ ] Confirm optional Sheet export does not become the sync source of truth.
- [ ] Verify no Google Sheet appears after sign-in unless optional Sheet export is explicitly used.
- [ ] Create a setup-plus-one-open-cycle test vault and confirm `Restore and repair as live` works.
- [ ] Create a multiple-open-cycle test vault and confirm read-only recovery instead of auto-repair.
- [ ] Reset the hidden Drive vault from Bluehour and confirm local financial data remains on that browser.
- [ ] Export and restore an encrypted backup.
- [ ] Confirm no demonstration record appears in the live Drive vault or optional Sheet export.
- [ ] Inspect the browser storage and confirm no OAuth access token is persisted.
- [ ] Verify safe-to-spend and the timeline against a small hand-calculated fixture.
- [ ] Verify Savings Coach purchase checks and pending goal contributions against a small hand-calculated fixture.

## Cross-Device Manual Gate

Laptop-to-desktop onboarding:

- [ ] Begin setup on device A
- [ ] Connect Google
- [ ] Save through the Budget step
- [ ] Confirm the remote revision advanced
- [ ] Open a clean browser profile on device B
- [ ] Continue with Google and confirm the same Drive vault loads
- [ ] Confirm onboarding resumes at the correct step
- [ ] Complete another step on device B
- [ ] Sync device B
- [ ] Reopen device A
- [ ] Check for remote changes
- [ ] Pull device B's update
- [ ] Confirm no duplicate accounts, plans, or allocations

Also test:

- [ ] Simultaneous non-conflicting edits
- [ ] Simultaneous conflicting edit
- [ ] Stale-device push rejection
- [ ] Conflict resolution
- [ ] Offline edits followed by reconnect
- [ ] Device disconnection
- [ ] Optional Sheet export
