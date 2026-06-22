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

Current IndexedDB schema version: `4`.

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

## Demo Fixture Version

Current demo fixture version: `v1-local-demo-v4`.

A fixture version change does not clear mutable profile data. Demo reset is explicit and affects only `bluehour-profile-demo`.

## Backup Schema

Backups include the full validated `BluehourSnapshot`, including import audit data. Restore decrypts, validates, warns about profile replacement, and replaces the local profile atomically after explicit confirmation.

## Budget Coach Preferences

Budget Coach does not add an IndexedDB store or Google Sheet tab. It stores preferences inside the existing `preferences` setting as typed `budgetCoach` data:

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

Recommendation results themselves are transient. Accepted category amounts become ordinary `BudgetAllocation` records and retain an approval note. This keeps backup, restore, Google A/B-slot staging, and sync conflict handling on the existing Settings and BudgetAllocations paths without a schema version bump.

Budget Coach amounts remain integer sen. Percentages are calculated as integer basis points. Historical category evidence uses up to the last six closed salary cycles and integer-safe medians; even-count medians round to the nearest sen.

## Import Audit

`ImportRowAudit` records one durable outcome for every normalized CSV row:

```text
created | strong_linked | uncertain | user_linked | ignored | failed
```

Each row stores the import batch ID, row index, file hash, normalized local date, normalized description, signed sen amount, imported account ID, source reference or row fingerprint, outcome, linked transaction ID when present, match score, match reasons, candidate transaction IDs and scores, decision source, decision timestamp, and optional rollback metadata.

The audit stores only normalized import facts and candidate metadata. It does not retain unnecessary raw banking columns.
