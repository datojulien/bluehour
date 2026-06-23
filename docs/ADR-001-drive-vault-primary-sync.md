# ADR-001: Drive Vault As Primary Sync

Date: 2026-06-23

## Status

Accepted for the v1 release-candidate track.

## Context

Bluehour is local-first. IndexedDB is the working store and offline queue, while live-profile sync must work across browsers without introducing a server that stores user financial data. Earlier planning treated Google Sheets as the first private remote store because Sheets are inspectable and portable, but Sheets are awkward as a primary sync database: user-visible spreadsheets invite manual edits, schema evolution is noisy, and concurrent writes are harder to stage safely.

## Decision

Use hidden Google Drive `appDataFolder` files as the primary remote sync store for the live profile:

- `bluehour-manifest.json`
- `bluehour-slot-A.json`
- `bluehour-slot-B.json`

Bluehour writes the inactive slot, reads it back for runtime validation and record comparison, then updates the manifest last. IndexedDB remains the local working database. Demo profiles never create, push, pull, or sync a Drive vault.

Google Sheets remain an optional manual export/inspection surface only. Current optional Sheet schema is v4 and includes `ExtraIncomeAllocations`.

## Consequences

- Sync uses the narrower `drive.appdata` scope for daily operation.
- Remote files are hidden from normal Drive browsing and are not casual user-editable spreadsheets.
- Staged writes can preserve the previous active slot if a push fails before manifest commit.
- Recovery is driven by the Drive manifest, active slot envelope, and synced `profileManifest` setting.
- Real deployed-origin Google verification remains a stable-release gate because automated tests use mocks.
