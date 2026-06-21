# Architecture

Bluehour is a static React + TypeScript app hosted on GitHub Pages. It is local-first: IndexedDB is the working store and Google Sheets is an optional remote backup/sync target for the live profile only.

```mermaid
flowchart TD
  UI[React routes and shell] --> Provider[BluehourDataProvider]
  Provider --> ShellDB[bluehour-shell IndexedDB]
  Provider --> DemoDB[bluehour-profile-demo IndexedDB]
  Provider --> LiveDB[bluehour-profile-live IndexedDB]
  LiveDB --> Sync[Google sync planner]
  Sync --> Sheets[Private Google Sheet v2 slots]
  Provider --> Domain[Pure domain services]
```

## Application State

The shell database stores only active mode and onboarding metadata. Supported states are:

- `welcome`
- `demo`
- `setup`
- `ready_for_salary`
- `live`
- `needs_google_reconnection`
- `sync_conflict`
- `read_only_recovery`

## Storage Isolation

- Demo profile: `bluehour-profile-demo`
- Live profile: `bluehour-profile-live`
- Shell metadata: `bluehour-shell`
- Legacy database: `bluehour-local`

The legacy database is detected where browser support allows it, but is not opened for migration or clearing by normal startup.

## Clock Model

Demo mode uses a deterministic clock. Live mode uses the current browser-local date. Forms receive the active `asOfDate` from the provider instead of hardcoding production dates.

## Notable Decisions

- Starter live categories are production taxonomy records, not fictional financial records.
- Demo mutations are local-only and never enter the sync outbox.
- Google sync actions are disabled in demo before token request.
