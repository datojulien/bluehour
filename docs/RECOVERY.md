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

## Google Sheet Recovery

Google Sheet schema v3 uses active/inactive slots. If a staged push fails before `Meta.activeSlot` is updated, the former active slot remains readable.

If a Sheet is malformed or uses a newer unsupported schema, Bluehour refuses to replace valid local data and enters read-only recovery.

## Continue From Existing Sheet

The welcome screen offers `Continue from an existing Bluehour Sheet`. This path never creates a new Sheet. It requires the user to:

1. Connect Google.
2. Paste a full Sheet URL or raw spreadsheet ID.
3. Let Bluehour inspect metadata, `Meta`, active slot records, schema version, remote revision, record counts, and the profile manifest.
4. Preview profile name, lifecycle, currency, last saved time, revision, and counts.
5. Confirm local device setup before any local replacement.

If the live profile on this device already contains meaningful records, Bluehour offers cancel/export/use local/replace choices in the UI and requires explicit replacement confirmation. Different profile IDs are never merged automatically.

Remote restore is atomic from the user's perspective: validation happens before local replacement, downloaded data creates no outbox operations, the connection descriptor is saved locally, `syncState` records the remote revision, and shell state is reconstructed from the manifest.

## Legacy Sheet Recovery

Legacy v1/v2/v3 Sheets may not contain a profile manifest. Bluehour can inspect them without writing, infer likely lifecycle from evidence, and ask the user to choose a resume point such as Accounts, Income, Obligations, Budget, Wait for salary, or live profile. A manifest is written only after explicit confirmation and a successful staged push.

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
