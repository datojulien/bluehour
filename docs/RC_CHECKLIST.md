# Bluehour Release Candidate Manual Checklist

This checklist is release-blocking for stable `1.0.0`. It is not claimed complete for the RC unless each item is manually performed and observed with a real Google account and the deployed app.

## Automated Gate Before `1.0.0-rc.2`

- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run test:coverage`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run test:e2e`

Budget Coach automated coverage passed locally on 22/06/2026; stable release still depends on the manual gate below.

Google Drive vault automated coverage passed locally on 22/06/2026; real Google OAuth and deployed-origin verification remain manual gates.

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
- [ ] Export and restore an encrypted backup.
- [ ] Confirm no demonstration record appears in the live Drive vault or optional Sheet export.
- [ ] Inspect the browser storage and confirm no OAuth access token is persisted.
- [ ] Verify safe-to-spend and the timeline against a small hand-calculated fixture.

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
