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

Budget Coach work remains unreleased until the full automated gate passes, including Chromium and WebKit browser coverage.

Cross-device recovery work remains unreleased until the full automated gate passes, including Chromium and WebKit browser coverage.

## External Manual Gate Before Stable `1.0.0`

- [ ] Configure `VITE_GOOGLE_CLIENT_ID` in GitHub repository variables.
- [ ] Enable Google Sheets API and Google Drive API in the Google Cloud project.
- [ ] Configure the authorised JavaScript origin in Google Cloud.
- [ ] Deploy GitHub Pages.
- [ ] Open the deployed app in Safari.
- [ ] Add Bluehour to the Mac Dock.
- [ ] Create a live profile containing no fictional data.
- [ ] Create a private Bluehour Google Sheet.
- [ ] Prepare all current schema tabs.
- [ ] Push the live profile.
- [ ] Confirm only the inactive slot was written before commit.
- [ ] Confirm `Meta.activeSlot` changed last.
- [ ] Reload and pull the same data.
- [ ] Make an offline transaction and confirm it enters the outbox.
- [ ] Reconnect and sync.
- [ ] Test token expiration/reconnection.
- [ ] Test a local/remote conflict using two browser profiles.
- [ ] Resolve the conflict explicitly.
- [ ] Read a legacy v1 Sheet as a migration source.
- [ ] Confirm the v1 Sheet remains unchanged.
- [ ] Export and restore an encrypted backup.
- [ ] Confirm no demonstration record appears in the live Sheet.
- [ ] Inspect the browser storage and confirm no OAuth access token is persisted.
- [ ] Verify safe-to-spend and the timeline against a small hand-calculated fixture.

## Cross-Device Manual Gate

Laptop-to-desktop onboarding:

- [ ] Begin setup on device A
- [ ] Connect Google
- [ ] Save through the Budget step
- [ ] Confirm the remote revision advanced
- [ ] Open a clean browser profile on device B
- [ ] Continue with Google and confirm the same Sheet is found without pasting a URL
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
- [ ] Legacy Sheet connection
