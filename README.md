# Bluehour

Bluehour is a React + TypeScript personal cash-flow and salary-cycle budgeting app for MYR. It is designed for a Mac-first Safari web-app experience and answers:

- How much can I safely spend?
- Will I have enough for upcoming expenses?
- Am I staying within my budgets?

The app is not production-ready `1.0.0` yet. See `PRODUCTION_READINESS.md` for the exact completed and remaining items.

## Demo And Live Profiles

First launch shows two choices:

- **Explore demonstration** opens isolated fictional MYR data with a fixed demo date.
- **Set up my finances** creates or resumes an empty live profile using the browser-local date.

Storage is isolated:

- Shell state: `bluehour-shell`
- Demo profile: `bluehour-profile-demo`
- Live profile: `bluehour-profile-live`
- Legacy prototype DB: `bluehour-local`, detected but left untouched

Demo data cannot create, push, pull, or sync a Google Sheet. Demo exports and backups are labelled fictional.

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

The Playwright suite includes the 25 production-readiness scenarios and automated axe accessibility checks.

Playwright browsers can be installed with:

```bash
npx playwright install chromium
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

1. Enable the **Google Sheets API** in APIs & Services.
2. Configure the OAuth consent screen.
3. Create an OAuth client for a web application.

A `Google Sheets create failed with 403` error usually means the Sheets API is not enabled for the project that owns `VITE_GOOGLE_CLIENT_ID`, or the OAuth consent/scope setup is incomplete.

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
https://www.googleapis.com/auth/drive.file
```

Access tokens are memory-only and are cleared after user-initiated actions.

## Google Sheet Storage

Live mode can create an app-managed private Sheet named `Bluehour Finance Data`.

Current Sheet schema version: `2`.

New pushes use an active/inactive slot protocol:

- `Meta`
- `A_...` data tabs
- `B_...` data tabs

Bluehour writes the inactive slot, reads it back for verification, then updates `Meta.activeSlot` last. Existing v1 single-slot Sheets can be read as a migration source.

Settings also includes a schema preparation action for existing Sheets; it adds any missing v2 tabs before push/sync without deleting data. Legacy v1 single-slot Sheet reading is covered with mocked tests, but a real legacy Sheet migration source still needs manual Google-account verification before `1.0.0`.

Manual Google verification before `1.0.0`:

1. Deploy with the GitHub Pages origin authorised in Google Cloud.
2. Create a private Bluehour Sheet from the live profile.
3. Prepare v2 tabs on an existing Sheet.
4. Push and sync live data using the app UI.
5. Reconnect after clearing the in-memory token.
6. Read a legacy v1 Sheet as a migration source without mutating it.

## Offline Behaviour

The app remains usable locally. Live mutations are saved to IndexedDB and queued in the outbox until Google sync is available. Demo mutations are local-only and never enter the Google outbox.

The service worker uses network-first navigation and versioned static-asset caching so an old cached `index.html` does not permanently pin obsolete bundles.

## Backup And Restore

Settings can create encrypted JSON backups with Web Crypto. The passphrase is never stored. Restore validates the backup, warns when profile types differ, and replaces the current local profile atomically after explicit confirmation.

## Privacy Model

- No analytics or telemetry.
- No account numbers, card numbers, banking credentials, passwords, or Google secrets are requested.
- Google tokens are never persisted.
- Privacy mode visually obscures amounts only; it is not encryption.
- Real financial data must never be committed to this repository.

## Limitations

Important remaining gaps are tracked in `PRODUCTION_READINESS.md`. The only remaining release blocker is external Google OAuth/Sheet verification with a real account and deployed origin.

## Recovery

See `docs/RECOVERY.md` for legacy database, read-only recovery, Google slot recovery, and backup restore notes.
