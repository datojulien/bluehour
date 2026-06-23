# Recovery

## Read-Only Recovery

If storage or sync validation fails, Bluehour can enter `read_only_recovery`. In this state, provider write APIs pause mutations and the recovery screen leaves export/backup options available.

## Legacy IndexedDB

The prototype database name `bluehour-local` is treated as legacy. Normal startup does not clear or migrate it.

Planned migration choices:

- Import legacy data as demo.
- Import legacy data as live.
- Leave the legacy database untouched.

Migration must validate every record before writing and must not overwrite either isolated profile silently.

## Google Drive Vault Recovery

The Google Drive vault uses active/inactive slot files. If a staged push fails before `bluehour-manifest.json` is updated, the former active slot remains readable.

If a Drive vault is malformed or uses a newer unsupported schema, Bluehour refuses to replace valid local data and enters read-only recovery.

Profile Health is part of Drive recovery. A Drive vault whose manifest still says `setup` or `ready_for_salary` while exactly one open salary cycle exists is repairable: Bluehour previews the issue and offers `Restore and repair as live`. The repair preserves transactions, allocations, and amounts, updates only the manifest/shell/sync metadata, and pushes the repaired manifest back to Drive after explicit confirmation and stale-revision checking.

If multiple open salary cycles are present, Bluehour does not guess. The restore path opens read-only recovery so exports remain available while writes stay paused.

## Continue With Google

The welcome screen offers `Continue with Google`. This path signs into Google and uses hidden Drive app-data files:

1. Sign in with Google.
2. Let Bluehour ensure the manifest and two slot files exist in `appDataFolder`.
3. Let Bluehour inspect the manifest, active slot records, schema version, remote revision, record counts, and the profile manifest.
4. If no vault exists, create the first staged Drive snapshot from this browser.
5. Preview profile name, lifecycle, currency, last saved time, revision, and counts.
6. Confirm local device setup before any local replacement.

If the live profile on this device already contains meaningful records, Bluehour offers cancel/export/use local/replace choices in the UI and requires explicit replacement confirmation. Different profile IDs are never merged automatically.

Remote restore is atomic from the user's perspective: validation happens before local replacement, downloaded data creates no outbox operations, the Drive connection descriptor is saved locally, `syncState` records the remote revision, and shell state is reconstructed from the manifest.

## Profile Health Repairs

The Settings and read-only Recovery screens show Profile Health: manifest lifecycle, onboarding step, open and closed salary-cycle counts, remote vault state, remote revision, pending local changes, and any structured health issues. Raw diagnostic JSON is hidden behind an Advanced diagnostics disclosure.

The common interrupted-start state is:

```text
profileManifest.lifecycle = setup or ready_for_salary
budgetCycles contains exactly one active open cycle
```

`Resume as live profile` changes the manifest to `live`, clears the onboarding step according to the manifest schema, sets shell state to live, and queues the metadata update for normal Drive sync. It does not change transaction amounts, budget allocations, or cycle records.

`Archive accidental cycle and continue onboarding` requires confirmation and archives only records Bluehour can identify as created by the first-cycle command: the open cycle, main salary transaction, salary leg, salary split, first-cycle budget allocations, and matching derived opening balance snapshots. Ambiguous records are not guessed.

## Optional Sheet Inspection

Legacy v1/v2/v3 Sheets may not contain a profile manifest. Current v5 Sheets include `ExtraIncomeAllocations`, `SavingsGoals`, `SavingsGoalContributions`, `CoachInsightDecisions`, and `PurchaseChecks` for inspection export. Bluehour keeps Sheet code for optional export and legacy inspection, but Sheets are not the primary recovery or sync source.

No Sheet is expected after Google sign-in. The recovery source is the hidden Drive app-data vault unless the user explicitly exported a Sheet for inspection.

## Reset Choices

Local reset clears only this browser's live IndexedDB profile and restarts setup. If the hidden Google Drive vault still contains the old remote copy, reconnecting Google may restore it.

Hidden Drive vault reset deletes the remote sync copy for the signed-in Google account, clears this browser's Google connection descriptor, discards the in-memory Google token, and preserves local financial data and pending local changes. Use both local reset and Drive vault reset only after exporting an encrypted backup if the goal is to start completely fresh.

## Older Snapshot Completion

Drive vault and Sheet recovery complete missing Savings Coach arrays as empty arrays before validation. This lets older RC snapshots remain inspectable while current v6 IndexedDB profiles persist the new stores locally and through sync.

## Stale Device Recovery

Before a push, Bluehour verifies:

```text
expectedRemoteRevision === actualRemoteRevision
```

If another device committed first, the push is blocked with `remote_revision_changed`. The user must check for changes, pull non-conflicting records or resolve conflicts, and then press Sync now again.

## Backup Restore

Encrypted backup restore should:

1. Decrypt with the passphrase.
2. Validate backup schema.
3. Validate every domain record.
4. Show a summary.
5. Require confirmation.
6. Replace records atomically.

Restore now validates the decrypted snapshot before replacement and leaves the current profile unchanged if validation fails.
