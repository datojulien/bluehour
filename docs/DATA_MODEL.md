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

Current IndexedDB schema version: `3`.

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

Current backup implementation uses authenticated Web Crypto encryption for serialized snapshots. Production restore still needs a fully staged profile-aware restore flow before `1.0.0`.
