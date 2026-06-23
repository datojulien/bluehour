# Profile Health And Repair

Profile Health prevents the user from getting trapped when local shell state, the synced `profileManifest`, and salary-cycle records disagree.

## What It Checks

Profile Health inspects records without using React, IndexedDB, or Google APIs. It checks:

- Missing manifest with no meaningful data.
- Missing manifest with setup records.
- Missing manifest with an open salary cycle.
- Setup or ready-for-salary manifest with no open cycle.
- Setup or ready-for-salary manifest with exactly one open cycle.
- Live manifest with one open or completed cycle.
- Live manifest with no cycle history.
- More than one open cycle.
- Archived cycles, which do not count as open.
- Closed cycles, which count as history but not as open.
- Browser shell state that differs from the manifest.
- Hidden Drive vault schema newer than this build supports.

## Common Repair

The common interrupted-start mismatch is:

```text
profileManifest.lifecycle = setup or ready_for_salary
exactly one active open budgetCycle exists
```

The safe repair is **Resume as live profile**. It updates the manifest to `live`, clears the onboarding step, sets shell state to live, and queues the metadata update for normal Google Drive vault sync. It does not change transaction amounts, budget allocations, salary-cycle records, account balances, or categories.

## Accidental Cycle Archive

If the open cycle was created by mistake, **Archive accidental cycle and continue onboarding** requires confirmation. Bluehour archives records only when they can be identified as outputs of the first-cycle command:

- Open salary cycle.
- Main salary transaction.
- Salary transaction leg.
- Salary transaction split.
- First-cycle budget allocations.
- Derived opening balance snapshots with the first-cycle note.

Records are archived, not permanently deleted. If the records are ambiguous, the repair is blocked and the user should export an encrypted backup before resetting.

## Recovery From Google

Continue with Google previews the hidden Google Drive app-data vault. No Google Sheet is expected after sign-in because Sheets are optional export/inspection only.

For a remote setup-plus-one-open-cycle mismatch, Bluehour offers **Restore and repair as live**. It restores the snapshot, repairs the manifest, sets the local shell to live, and pushes the repaired manifest back to Drive only after explicit confirmation and stale-revision checking.

For multiple open cycles or unsupported newer schemas, Bluehour offers read-only recovery instead of automatic repair. Exports remain available while writes are paused.

## Reset Choices

**Reset local data** clears this browser's local live IndexedDB profile only. If the hidden Google Drive vault still contains the previous remote copy, reconnecting Google may restore it.

**Reset hidden Google Drive vault** deletes the remote app-data files for the signed-in Google account:

- `bluehour-manifest.json`
- `bluehour-slot-A.json`
- `bluehour-slot-B.json`

This action requires typing `RESET GOOGLE VAULT`, checks the current remote revision, clears this browser's Google connection descriptor, clears the in-memory Google token, and preserves local financial data plus pending local outbox changes.

Export an encrypted backup before either reset if the current profile may be needed later.

## Stable Release Gate

Automated tests use mocked Google Identity and Drive APIs. Real deployed-origin OAuth, real hidden Drive vault creation, cross-browser repair, optional Sheet export, and vault reset remain manual gates before Bluehour can be labelled stable `1.0.0`.
