# Data Model

All monetary amounts are integer sen. Financial dates are ISO local dates. Durable records carry metadata:

```text
id
createdAt
updatedAt
archivedAt
revision
lastModifiedByClientId?
```

## IndexedDB Schema

Current IndexedDB schema version: `5`.

Profile databases contain:

- `accounts`
- `balanceSnapshots`
- `transactions`
- `transactionLegs`
- `transactionSplits`
- `categories`
- `budgetCycles`
- `budgetAllocations`
- `budgetTransfers`
- `recurringRules`
- `planInstances`
- `subscriptions`
- `extraIncomeAllocations`
- `categorisationRules`
- `importProfiles`
- `importBatches`
- `importRowAudits`
- `reconciliations`
- `reviewSessions`
- `settings`
- `outboxOperations`
- `conflicts`
- `syncState`
- `meta`

## Profile Databases

```text
bluehour-shell          shell state and onboarding metadata
bluehour-profile-demo   fictional demonstration records
bluehour-profile-live   real user profile records
bluehour-local          legacy prototype database, left untouched
```

`bluehour-shell` also stores a local-only random device identity:

```text
deviceId
createdAt
displayLabel?   local only
```

The device ID is generated with `crypto.randomUUID()`. It is not derived from hardware and is not proof of ownership.

## Demo Fixture Version

Current demo fixture version: `v1-local-demo-v5`.

A fixture version change does not clear mutable profile data. Demo reset is explicit and affects only `bluehour-profile-demo`.

Schema v5 adds `extraIncomeAllocations` and performs a non-destructive starter-category taxonomy reconciliation. Existing live categories are repaired or added where needed, archived categories stay archived, and changed live records enter the outbox. A blank live profile remains locally saved without generating category sync noise.

## Backup Schema

Backups include the full validated `BluehourSnapshot`, including import audit data. Restore decrypts, validates, warns about profile replacement, and replaces the local profile atomically after explicit confirmation.

## Budget Coach Preferences

Budget Coach does not add an IndexedDB store, Drive vault file, or Google Sheet tab. It stores preferences inside the existing `preferences` setting as typed `budgetCoach` data:

```text
profileId: flexible | balanced | secure
essentialPreferences[]
  categoryId
  minimumMinor
  comfortableMinor
  priority: low | normal | high
discretionaryPreferences[]
  categoryId
  enabled
  priority: low | normal | high
acceptedDecisions[]
  id
  acceptedAt
  cycleId?
  profileId
  confidence
  appliedCategoryIds[]
```

Recommendation results themselves are transient. Accepted category amounts become ordinary `BudgetAllocation` records and retain an approval note. This keeps backup, restore, Google Drive vault staging, optional Sheet export, and sync conflict handling on the existing Settings and BudgetAllocations paths without a schema version bump.

Budget Coach amounts remain integer sen. Percentages are calculated as integer basis points. Historical category evidence uses up to the last six closed salary cycles and integer-safe medians; even-count medians round to the nearest sen.

## Category Taxonomy

Starter categories are durable records with stable IDs. RC2 reconciles missing or outdated starter taxonomy records for fixed transport, tolls and parking, personal care, hobbies, gifts, miscellaneous, planned major payments, bank fees, and taxes. Discretionary categories use envelope reservation mode by default.

Category management validates group, nature, and reservation-mode combinations before records are saved. System categories can be renamed or moved where allowed, but they cannot be archived.

## Budget Progress

Budget progress is derived, not stored. The shared model reads active category allocations, transaction splits, and scheduled plan instances for a cycle, then reports:

```text
allocationMinor
spentMinor
reservedFuturePlansMinor
remainingBeforeFuturePlansMinor
remainingAfterFuturePlansMinor
percentageUsedOrReserved
state
```

Transfers and archived records are excluded from spending. Future reserved plans remain visible so Overview and Budgets agree about what is already committed.

## Extra Income Allocations

Extra income decisions are stored in `extraIncomeAllocations`:

```text
incomeTransactionId
budgetCycleId?
incomeAmountMinor
availableMinor
protectedMinor
protectedAccountId?
status: available_only | pending_transfer | completed | deferred
linkedTransferTransactionId?
```

Pending protected allocations reduce safe-to-spend for the matching salary cycle until the user records and confirms the protected transfer link. Deferred allocations appear in Daily Review.

## Subscriptions

Subscriptions keep provider metadata, billing cadence, next payment date, optional annual renewal date, optional cancellation deadline, essential flag, notes, and optional price-history JSON. Monthly equivalents are derived with documented integer rounding and are not written back as stored money.

## Profile Manifest

Cross-device recovery stores a typed `profileManifest` record in the existing synced `settings` store. No new IndexedDB store, Drive vault file, or Google Sheet tab is added.

```text
manifestVersion
profileId                 stable UUID
profileName
currency                  MYR
lifecycle                 setup | ready_for_salary | live | read_only_recovery
onboardingStep?           google | preferences | accounts | income | obligations | budget | wait_salary | start_cycle
createdAt
updatedAt
createdByAppVersion
updatedByAppVersion?
lastWrittenByDeviceId?
```

The manifest participates in normal Settings backup, restore, Google Drive vault staging, optional Sheet export, and conflict handling. It is schema-validated when loaded from IndexedDB, backup, Drive vaults, or Google Sheets. It does not store Google email, account numbers, device labels, computer names, hardware IDs, or IP addresses.

Downloaded remote records do not create outbox operations. A remote restore writes a complete validated local snapshot, a local Google connection descriptor, synced `syncState`, and reconstructed shell state atomically from the user-confirmed profile.

`googleConnection` settings written by current builds contain the Drive vault descriptor:

```text
provider: drive_appdata
vaultSchemaVersion
profileId
driveManifestFileId
driveSlotAFileId
driveSlotBFileId
googleSubject?
googleEmail?
googleName?
lastKnownRemoteRevision
lastSuccessfulSyncAt?
```

Legacy Sheet descriptors remain readable for optional export/inspection migration, but new sync descriptors use the Drive vault provider.

## Import Audit

`ImportRowAudit` records one durable outcome for every normalized CSV row:

```text
created | strong_linked | uncertain | user_linked | ignored | failed
```

Each row stores the import batch ID, row index, file hash, normalized local date, normalized description, signed sen amount, imported account ID, source reference or row fingerprint, outcome, linked transaction ID when present, match score, match reasons, candidate transaction IDs and scores, decision source, decision timestamp, and optional rollback metadata.

The audit stores only normalized import facts and candidate metadata. It does not retain unnecessary raw banking columns.
