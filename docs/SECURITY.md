# Security And Privacy

Bluehour is a static browser app. The deployed app code is public. By default, the user's financial data stays in local IndexedDB and, when configured, in hidden Google Drive app-data files owned by the user's Google account. The Gemini cycle report is an explicit opt-in exception described below.

## Privacy Rules

- No analytics, telemetry, or remote error reporting.
- No bank credentials, account numbers, card numbers, passwords, or Google OAuth client secrets are requested.
- Google access tokens are memory-only for the current tab, capped at about one hour, and are not written to IndexedDB, localStorage, sessionStorage, URLs, Drive vault files, optional Sheets, logs, or repository files.
- Continue-with-Google uses OpenID profile metadata plus the `drive.appdata` scope to find or create hidden app-data files. It does not request broad visible-Drive access.
- Drive app-data file IDs and optional Sheet IDs are not passwords or authorization. Google access still controls the remote files.
- Local device IDs are random UUIDs stored in `bluehour-shell`. They are not derived from hardware and are not authentication.
- Privacy mode visually obscures amounts only; it is not encryption.
- Demo exports are labelled fictional.
- Budget Coach runs entirely in the browser against local data. It does not call AI services, advice APIs, analytics, telemetry, remote logging, or external financial-data services.
- Budget Coach is educational budgeting guidance only. It must not be represented as investment, tax, legal, credit, or regulated financial advice.
- Savings Coach also runs entirely in the browser against local IndexedDB or the synced Drive vault snapshot. It does not call AI services, advice APIs, analytics, telemetry, remote logging, merchant enrichment services, subscription APIs, or external financial-data services.
- Savings Coach outputs are educational planning prompts. The app never automatically creates purchases, bank transfers, budget cuts, subscription cancellations, goals, or insight decisions.
- Gemini cycle reports are disabled for the fictional demo profile and require explicit live-profile approval before sending a redacted salary-cycle payload to Gemini. The Gemini API key is entered per report and is not written to IndexedDB, localStorage, sessionStorage, URLs, Drive vault files, optional Sheets, logs, or repository files. Gemini reports are transient in the browser; selecting a proposed budget only changes records after the user completes salary-cycle close.
- Gemini cycle reports are educational budgeting guidance only. They must not be represented as investment, tax, legal, credit, insurance, or regulated financial advice.
- Category management, extra-income allocation, Daily Review, Recent Activity, cycle comparison, and subscription alerts are local derivations from IndexedDB or the Drive vault snapshot. They do not introduce analytics, telemetry, or third-party finance calls.
- Continue-with-Google inspection does not replace a meaningful local profile until the user confirms restore/replacement.
- Automatic sync uses only a currently valid in-memory token. When the one-hour gate expires, sync pauses until the user reconnects with Google.

## Local Security Boundary

Real live data in IndexedDB is protected primarily by the user's macOS account and browser sandbox. Local cache encryption at rest is not implemented for v1.

The Settings danger-zone reset clears only this browser's live IndexedDB profile after typed confirmation. It preserves the hidden Google Drive vault and any other browser caches, so remote deletion or overwrite remains an explicit later sync choice.

## Backup Encryption

Encrypted JSON backups use Web Crypto authenticated encryption. The passphrase is never stored.

## Known Security Work Remaining

- Real OAuth manual verification against a production Google Cloud client.
- Manual inspection that no OAuth token is persisted after deployed Google reconnection.
- Stable `1.0.0` sign-off after the full `docs/RC_CHECKLIST.md` Google Drive vault and browser checklist is completed.
