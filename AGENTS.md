# Bluehour Agent Guide

## Project Purpose

Bluehour is a single-user, MYR-only, Mac-first personal finance app for salary-cycle cash-flow planning. It answers how much can be safely spent, whether upcoming expenses are covered, and whether budgets are on track.

## Architectural Invariants

- Keep domain calculations independent of React, IndexedDB, and Google Sheets.
- Use local IndexedDB as the working database and offline queue.
- Keep demo and live profiles isolated in separate IndexedDB databases.
- Treat `bluehour-local` as legacy data. Do not clear or migrate it silently.
- Archive records by default instead of deleting them.
- Require explicit user approval for budget transfers, categorisation rules, reconciliation adjustments, buffer changes, and sync conflict resolution.

## Money And Date Rules

- Store MYR amounts as integer sen.
- Do not use floating-point arithmetic in financial domain calculations.
- Display money as `RM1,234.50`.
- Use documented integer rounding for percentages.
- Store financial dates as ISO local dates, `YYYY-MM-DD`.
- Display dates as `DD/MM/YYYY`.
- Use the active clock service for form defaults and live workflows.

## Data Privacy Rules

- Never commit real financial data, exports, screenshots, access tokens, account numbers, card numbers, banking credentials, Google secrets, or passwords.
- Google OAuth access tokens are memory-only.
- Privacy mode is visual concealment only, not encryption.
- Do not add analytics, telemetry, remote logging, or error-reporting services.
- Demo exports and backups must be labelled fictional.
- Demo data must never be pushed to Google or mixed into the live profile.

## Required Commands Before Completion

```bash
npm ci
npm run lint
npm test
npm run test:coverage
npm run typecheck
npm run build
npm run test:e2e
```

## Current Cautions

- The app is not labelled production-ready or versioned `1.0.0`.
- Google OAuth and live Drive app-data vault sync are tested with mocks only; real deployed-origin verification remains a manual release gate.
- Remaining stable-release gates are documented in `PRODUCTION_READINESS.md` and `docs/RC_CHECKLIST.md`.
