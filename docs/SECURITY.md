# Security And Privacy

Bluehour is a static browser app. The deployed app code is public. The user's financial data stays in local IndexedDB and, when configured, in a private Google Sheet owned by the user's Google account.

## Privacy Rules

- No analytics, telemetry, or remote error reporting.
- No bank credentials, account numbers, card numbers, passwords, or Google secrets are requested.
- Google access tokens are memory-only and are not written to IndexedDB, localStorage, sessionStorage, URLs, the Sheet, logs, or repository files.
- Sheet IDs and optional `#connect=<spreadsheet-id>` links are not passwords or authorization. Google access still controls the Sheet.
- Local device IDs are random UUIDs stored in `bluehour-shell`. They are not derived from hardware and are not authentication.
- Privacy mode visually obscures amounts only; it is not encryption.
- Demo exports are labelled fictional.
- Budget Coach runs entirely in the browser against local data. It does not call AI services, advice APIs, analytics, telemetry, remote logging, or external financial-data services.
- Budget Coach is educational budgeting guidance only. It must not be represented as investment, tax, legal, credit, or regulated financial advice.
- Continue-from-existing-Sheet inspection does not write to the remote Sheet or local profile until the user confirms restore/replacement.

## Local Security Boundary

Real live data in IndexedDB is protected primarily by the user's macOS account and browser sandbox. Local cache encryption at rest is not implemented for v1.

## Backup Encryption

Encrypted JSON backups use Web Crypto authenticated encryption. The passphrase is never stored.

## Known Security Work Remaining

- Real OAuth manual verification against a production Google Cloud client.
- Manual inspection that no OAuth token is persisted after deployed Google reconnection.
- Stable `1.0.0` sign-off after the full `docs/RC_CHECKLIST.md` Google and Safari Dock-app checklist is completed.
