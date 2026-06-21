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

Vite prints a local URL, usually `http://localhost:5173/`.

Optional Google OAuth config for local testing:

```bash
cp .env.example .env
```

Then set:

```text
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
```

## Checks

```bash
npm run lint
npm test
npm run test:coverage
npm run typecheck
npm run build
npm run test:e2e
```

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

Create an OAuth client for a web application in Google Cloud and add the deployed GitHub Pages origin, for example:

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

Bluehour writes the inactive slot, reads it back for verification, then updates `Meta.activeSlot` last. Existing v1 single-slot Sheets can be read for migration, but the non-destructive migration UI remains incomplete.

## Offline Behaviour

The app remains usable locally. Live mutations are saved to IndexedDB and queued in the outbox until Google sync is available. Demo mutations are local-only and never enter the Google outbox.

The service worker uses network-first navigation and versioned static-asset caching so an old cached `index.html` does not permanently pin obsolete bundles.

## Backup And Restore

Settings can create encrypted JSON backups with Web Crypto. The passphrase is never stored. Restore support exists, but full staged atomic restore with profile-type warnings remains a production-readiness item.

## Privacy Model

- No analytics or telemetry.
- No account numbers, card numbers, banking credentials, passwords, or Google secrets are requested.
- Google tokens are never persisted.
- Privacy mode visually obscures amounts only; it is not encryption.
- Real financial data must never be committed to this repository.

## Limitations

Important remaining gaps are tracked in `PRODUCTION_READINESS.md`. The largest are the full CSV mapping wizard, complete plan-confirmation variance UI, cross-salary virtual-cycle forecasting, complete recovery flows, and real Google OAuth/Sheet verification.

## Recovery

See `docs/RECOVERY.md` for legacy database, read-only recovery, Google slot recovery, and backup restore notes.
