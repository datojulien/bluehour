# Bluehour

Bluehour is a React + TypeScript personal cash-flow and salary-cycle budgeting app for MYR. It is designed for a Mac-first Safari web-app experience and answers:

- How much can I safely spend?
- Will I have enough for upcoming expenses?
- Am I staying within my budgets?

The app is prepared as a release-candidate track, not stable `1.0.0`. See `PRODUCTION_READINESS.md` and `docs/RC_CHECKLIST.md` for the exact verified status and the manual Google release gate.

## Demo And Live Profiles

First launch shows three choices:

- **Explore demonstration** opens isolated fictional MYR data with a fixed demo date.
- **Continue with Google** signs in with Google and opens a hidden Drive app-data vault for cross-browser sync.
- **Set up locally first** creates or resumes an empty live profile using the browser-local date and lets the user connect Google later.

Storage is isolated:

- Shell state: `bluehour-shell`
- Demo profile: `bluehour-profile-demo`
- Live profile: `bluehour-profile-live`
- Legacy prototype DB: `bluehour-local`, detected but left untouched

Demo data cannot create, push, pull, or sync a Google Drive vault or Google Sheet export. Demo exports and backups are labelled fictional.

## Local Setup

```bash
npm ci
npm run dev
```

Vite serves the local app at:

```text
http://127.0.0.1:5173/
```

The dev server uses a strict port because Google OAuth origins are exact. If port `5173` is already in use, stop the other Vite process instead of letting the app move to a different port.

Optional Google OAuth config for local testing:

```bash
cp .env.example .env
```

Then set:

```text
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
```

Restart `npm run dev` after changing `.env`; Vite reads environment variables at startup.

## Checks

```bash
npm run lint
npm test
npm run test:coverage
npm run typecheck
npm run build
npm run test:e2e
```

The Playwright suite includes production-readiness scenarios, Drive-vault browser flows, WebKit critical flows, and automated axe accessibility checks.

Playwright browsers can be installed with:

```bash
npx playwright install chromium webkit
```

## Production Build

```bash
npm run build
```

The production Vite base is `/bluehour/` for GitHub Pages.

## GitHub Pages Deployment

The CI workflow runs lint, unit tests, coverage, typecheck, production build, and Playwright tests before deploying Pages.

Configure this GitHub repository variable:

```text
VITE_GOOGLE_CLIENT_ID
```

It is a public browser OAuth client ID, not a secret.

## Google Cloud OAuth Setup

Use the same Google Cloud project for every step below:

1. Enable the **Google Drive API** in APIs & Services for the primary Drive vault.
2. Enable the **Google Sheets API** only if you want optional Sheet export/inspection.
3. Configure the OAuth consent screen.
4. Create an OAuth client for a web application.

A `Google Drive app-data file failed with 403` or `Google Sheets create failed with 403` error usually means the matching API is not enabled for the project that owns `VITE_GOOGLE_CLIENT_ID`, or the OAuth consent/scope setup is incomplete.

For local development, add this exact authorized JavaScript origin:

```text
http://127.0.0.1:5173
```

If you deliberately use localhost instead, add it separately:

```text
http://localhost:5173
```

```text
https://datojulien.github.io
```

If using project pages, the app path is:

```text
https://datojulien.github.io/bluehour/
```

Bluehour requests only:

```text
openid
email
profile
https://www.googleapis.com/auth/drive.appdata
```

Optional Google Sheet export requests this scope only when the export button is used:

```text
https://www.googleapis.com/auth/drive.file
```

Access tokens are memory-only and are cleared after user-initiated actions. Bluehour stores only non-secret Google account metadata, Drive app-data file IDs, and remote revision details locally.

## Google Drive Vault Storage

Live mode stores the synced profile in hidden files under the user's Google Drive `appDataFolder`. These files are not visible in normal Drive browsing and are accessible only to Bluehour's OAuth client.

Current Drive vault schema version: `1`.

The vault uses three app-data files:

- `bluehour-manifest.json`
- `bluehour-slot-A.json`
- `bluehour-slot-B.json`

Bluehour writes the inactive slot, reads it back for runtime-schema validation and round-trip comparison, then updates `bluehour-manifest.json` last. The manifest stores schema version, remote revision, active slot, profile ID, app version, commit timestamp, and last writer device ID.

Google Sheets remain available from Settings as optional manual export/inspection. Sheets are not used for login, onboarding, or daily sync.

Cross-device recovery uses a typed `profileManifest` settings record synced with the live profile. It stores a random profile UUID, lifecycle (`setup`, `ready_for_salary`, `live`, or `read_only_recovery`), current onboarding checkpoint where relevant, MYR currency, app version metadata, timestamps, and optional last-writing local device ID. It does not store Google email, computer name, account numbers, or hardware identifiers.

Each browser also has a random local device ID stored only in `bluehour-shell`. The optional local label stays local. The device ID is diagnostic metadata only, not authentication.

Before pushing, Bluehour reads the current Drive vault revision and blocks stale-device writes when the remote profile has advanced. Sync then pulls non-conflicting remote changes, preserves local outbox changes, or creates explicit conflicts for same-record edits. Different profile IDs are never merged automatically.

Moving from laptop to desktop:

1. On the laptop, choose Continue with Google or connect Google in Settings.
2. Press Save progress to Google or Sync Drive vault.
3. Confirm the app says Saved to Google Drive.
4. On the desktop, open Bluehour.
5. Choose Continue with Google.
6. Sign into the same Google account.
7. Let Bluehour load the hidden Drive vault.
8. Confirm the remote profile if this browser already contains local live data.
9. Continue onboarding or open the dashboard.
10. Before returning to the laptop, sync the desktop.
11. On the laptop, reconnect and check for changes.

Manual Google verification before stable `1.0.0` is tracked in `docs/RC_CHECKLIST.md`. Do not treat mocked Google tests as real OAuth verification.

## Offline Behaviour

The app remains usable locally. Live mutations are saved to IndexedDB and queued in the outbox until Google sync is available. Demo mutations are local-only and never enter the Google outbox.

The service worker uses network-first navigation and versioned static-asset caching so an old cached `index.html` does not permanently pin obsolete bundles.

## Forecasting And Imports

Bluehour stores and calculates all MYR values as integer sen. Salary-day projections are segmented so the current cycle ends the day before payday and the virtual future cycle begins on payday. The cash-flow timeline includes confirmed income, projected salary, plan-reserved payments, subscriptions, dated plans, protected contribution assumptions, and deterministic essential-envelope distributions.

CSV imports save a durable audit row for every normalized row. Strong duplicates link to existing transactions without creating new ledger records; uncertain matches persist ranked candidate transaction IDs until the user links, creates, or ignores the row.

## Budget Coach

Budget Coach is deterministic, local-only educational budgeting guidance. It does not call an AI, advice API, analytics service, or external financial-data service.

It creates first-cycle recommendations during onboarding and remains available from Budgets and Review. Recommendations use the main salary, known commitments, user-entered essential minimums and comfortable amounts, protected contribution profile, and the active safety-buffer rule. Possible or variable income is excluded from the recurring base budget and shown only as separate scenario context.

Profiles are:

- **Flexible:** at least 10% protected, or the user's configured higher minimum.
- **Balanced:** at least 15% protected when affordable.
- **Secure:** at least 20% protected when affordable.

If a profile target does not fit, Budget Coach may recommend the highest affordable protected amount down to the configured minimum and explains the adjustment. If the configured minimum also does not fit, it shows the real shortfall and keeps safe-to-spend at RM0.00 until the user explicitly accepts a constrained plan.

Priority weights are Low 1, Normal 2, High 3. Essential categories are funded from minimum toward comfortable amounts before discretionary categories receive any pool. Completed salary cycles improve confidence from Estimated to Observed, then Reliable after three or more completed cycles.

## Backup And Restore

Settings can create encrypted JSON backups with Web Crypto. The passphrase is never stored. Restore validates the backup, warns when profile types differ, and replaces the current local profile atomically after explicit confirmation.

## Privacy Model

- No analytics or telemetry.
- No account numbers, card numbers, banking credentials, passwords, or Google secrets are requested.
- Google tokens are never persisted.
- Privacy mode visually obscures amounts only; it is not encryption.
- Real financial data must never be committed to this repository.

## Limitations

Important remaining gaps are tracked in `PRODUCTION_READINESS.md`. The expected remaining stable-release blocker is external Google OAuth and Drive app-data vault verification with a real account and deployed origin.

## Recovery

See `docs/RECOVERY.md` for legacy database, read-only recovery, Drive vault recovery, optional Sheet export, and backup restore notes.
