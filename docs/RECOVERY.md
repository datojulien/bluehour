# Recovery

## Read-Only Recovery

If storage or sync validation fails, Bluehour can enter `read_only_recovery`. In this state, writes should be paused and exports should remain available. The full recovery UI is still incomplete.

## Legacy IndexedDB

The prototype database name `bluehour-local` is treated as legacy. Normal startup does not clear or migrate it.

Planned migration choices:

- Import legacy data as demo.
- Import legacy data as live.
- Leave the legacy database untouched.

Migration must validate every record before writing and must not overwrite either isolated profile silently.

## Google Sheet Recovery

Google Sheet schema v2 uses active/inactive slots. If a staged push fails before `Meta.activeSlot` is updated, the former active slot remains readable.

If a Sheet is malformed, Bluehour should refuse to replace valid local data. The complete unsupported-schema recovery UI remains a readiness item.

## Backup Restore

Encrypted backup restore should:

1. Decrypt with the passphrase.
2. Validate backup schema.
3. Validate every domain record.
4. Show a summary.
5. Require confirmation.
6. Replace records atomically.

The current backup decrypt/restore path exists, but a full staged atomic replacement flow is still incomplete.
