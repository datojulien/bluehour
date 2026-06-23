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

## Optional Sheet Inspection

Legacy v1/v2/v3 Sheets may not contain a profile manifest. Current v4 Sheets include `ExtraIncomeAllocations` for inspection export. Bluehour keeps Sheet code for optional export and legacy inspection, but Sheets are not the primary recovery or sync source.

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
