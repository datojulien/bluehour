# Bluehour 1.0.0-rc.1 Manual Release Checklist

This checklist is release-blocking for stable `1.0.0`. It is not claimed complete for the RC unless each item is manually performed and observed with a real Google account and the deployed app.

- [ ] Configure `VITE_GOOGLE_CLIENT_ID` in GitHub repository variables.
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
