# Bluehour

Bluehour is a React + TypeScript implementation of the v1 personal cash-flow and salary-cycle budgeting specification.

It runs local-first, seeds fictional MYR demonstration data into IndexedDB, keeps money as integer sen, and exposes the safe-to-spend calculation with an auditable breakdown.

## What Is Included

- Vite, React, TypeScript, strict type checking, and hash routing.
- A Mac-first responsive shell with desktop sidebar and narrow-screen bottom navigation.
- Safari web app metadata, manifest, icon, and service worker for app-shell caching.
- Local IndexedDB storage with typed repository access and runtime validation.
- Fictional MYR demo data and local-first mutation outbox.
- Safe-to-spend calculation engine with explainable reserves and forecast output.
- Manual transaction entry, splits, transfers, refunds, planned-payment fulfilment, archive, and CSV import with duplicate outcomes.
- Transaction search/filter, import batch rollback, categorisation rule review, and rule proposals.
- First salary-cycle start, salary-cycle close, budget-template carry-forward, budget allocations, explicit budget transfers, recurring plans, subscriptions, net worth snapshots, review checklists, and reconciliation adjustments.
- CSV exports and encrypted JSON backup/restore.
- Google Sheet connection descriptor support plus a Google Identity Services token flow that keeps access tokens in memory only.
- Bidirectional Google Sheet sync planning with remote revision checks, local outbox pushes, remote pulls, merge application, and explicit conflict review.
- Vitest coverage for money, balances, salary cycles, safe-to-spend, transfers, splits, refunds, budgets, recurrence, duplicate matching, CSV safety, encrypted backup, Google adapter calls, Sheet serialization, sync planning, transaction commands, and IndexedDB demo seeding.
- GitHub Actions checks and GitHub Pages deployment workflow.

The app is still public static web code. Do not commit real financial exports or screenshots. Google access tokens are never written to IndexedDB, localStorage, the repository, or the Sheet.

## Setup

```bash
npm install
npm run dev
```

Vite will print a local URL, usually `http://localhost:5173/`.

## Usage

Open the app and use the sidebar routes. The first launch creates a fictional demo profile in IndexedDB. Amounts are displayed in MYR as `RM1,234.50`, and dates use `DD/MM/YYYY`.

The safe-to-spend amount can be opened for a breakdown of account balances, committed plans, essential envelope reserves, protected contribution status, safety buffer, discretionary cap, and included or excluded income.

Use **Transactions** for quick entry, splits, transfers, refunds, search/filter, archiving, CSV import, import rollback, and categorisation rules. Use **Plan**, **Budgets**, **Subscriptions**, **Net Worth**, and **Review** for the corresponding v1 workflows. Use **Settings** for account setup, first salary-cycle setup, Google descriptor recovery, encrypted backup/restore, and CSV exports.

Privacy mode is available from the toolbar or with `⌘⇧P`. `⌘N` opens transaction entry, `⌘K` opens the command menu, and `/` focuses transaction search. Privacy mode visually obscures amounts only; it is not encryption.

## Google Sheets

To create a private Bluehour Sheet from the browser, provide a Google OAuth client ID at build time:

```bash
VITE_GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com" npm run dev
```

The Settings page can then request a user-initiated token, create `Bluehour Finance Data`, save only the spreadsheet ID/schema descriptor locally, push the local snapshot to the Sheet using `RAW` values, or run **Sync now**.

Without a client ID, you can paste an existing Bluehour Sheet URL or ID in Settings and download a connection descriptor. The local app remains usable offline either way.

Sync reads the Sheet remote revision, applies non-conflicting remote changes locally, pushes local outbox changes when safe, and creates conflict records when the same financial record changed locally and remotely. Conflicts appear in Settings and require choosing the local or remote version. Token expiry requires a new user action because access tokens are never persisted.

## Safari Web App

For a deployed GitHub Pages build:

1. Open the Bluehour site in Safari.
2. Choose **File → Add to Dock**.
3. Launch Bluehour from the Dock.

The app uses a web manifest and service worker so the installed app can relaunch the cached shell after a successful first visit.

## Checks

```bash
npm test
npm run typecheck
npm run build
```

The production build uses `/bluehour/` as the Vite base path for GitHub Pages.
