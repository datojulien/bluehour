# Bluehour — Product and Technical Specification

**Status:** Build-ready v1 specification  
**Date:** 21/06/2026  
**Working name:** Bluehour  
**Primary user:** One person  
**Currency:** MYR only in v1  
**Interface language:** English  
**Date display:** `DD/MM/YYYY`  
**Amount display:** `RM1,234.50`

> Bluehour is a calm, Mac-first personal finance application that answers three questions: How much can I safely spend? Will I have enough for upcoming expenses? Am I staying within my budgets?

---

## 1. Product definition

Bluehour is not a general accounting suite and not an investment-trading terminal. It is a personal cash-flow and salary-cycle budgeting application with six primary jobs:

1. Make transaction entry quick enough for daily use.
2. Reserve money for obligations before showing discretionary money.
3. Forecast the next salary date, the calendar month, and the next 30 days.
4. Help the user maintain category budgets without forcing a rigid budgeting ideology.
5. Help the user find explicit, user-approved savings opportunities during the salary cycle.
6. Keep the data portable through the hidden Google Drive app-data vault, optional Google Sheet inspection export, CSV exports, and encrypted JSON backups.

### Product principles

- **Truth before optimism:** expected money is not presented as received money.
- **Explain every number:** every total opens a breakdown showing its inputs.
- **No silent financial decisions:** category transfers, rule creation, reconciliation adjustments, and buffer changes require approval.
- **Preserve history:** records are archived rather than silently deleted.
- **Calm over theatrical:** plain-language explanations, restrained charts, and no decorative dashboard clutter.
- **Local-first interaction:** the application remains usable during a temporary loss of connectivity and synchronises later.
- **Portable by design:** Google Drive app-data sync is the primary remote path, Google Sheets remain an optional inspection/export path, and the repository boundary keeps future migration possible.

### Explicit non-goals for v1

- Automatic bank connections
- Receipt photographs or OCR
- Individual share holdings and live market prices
- Push notifications while the application is closed
- Multiple users or shared household budgeting
- Supabase
- Native App Store distribution
- Multi-currency calculations
- Formal bookkeeping, tax returns, or business accounting

---

## 2. Confirmed user decisions

### Use and presentation

- One user only.
- Primarily used on a Mac mini through a Safari web app added to the Dock.
- Responsive layout retained for possible iPhone use later.
- English interface.
- Light mode.
- Deep blue and cool grey visual direction.
- Monetary values include cents.
- Main date format: `21/06/2026`.
- Main amount format: `RM1,234.50`.

### Financial scope

Bluehour can represent:

- Bank/current accounts
- Savings accounts
- Cash
- E-wallets
- Credit cards
- Loans and other liabilities
- Investment accounts
- Property
- Vehicles
- Other manually valued assets

Accounts are classified by their role in calculations:

- **Spendable:** included in safe-to-spend.
- **Protected:** liquid but excluded from ordinary spending.
- **Investment:** included in net worth, excluded from safe-to-spend.
- **Asset:** included in net worth, excluded from safe-to-spend.
- **Liability:** included in net worth; only scheduled repayments affect cash-flow forecasts.

### Budget and income rules

- Budget cycles run from the actual arrival of the main salary until the day before the next actual salary.
- Usual salary window: the 24th to the 26th, sometimes earlier because of holidays.
- The main salary amount is fixed or nearly fixed.
- Variable extra income uses confidence levels.
- Unused category allocations expire when a salary cycle closes.
- Overspending produces an invitation to transfer budget from another category; Bluehour never moves it automatically.
- Savings and investment contributions are transfers to protected accounts, not ordinary spending.
- Minimum protected contribution: 10% of the actual main salary deposited.
- Extra income always asks how much should be protected and how much should become available.
- Safety buffer: the greater of RM500 or 10% of remaining essential obligations.
- After six completed cycles, Bluehour may recommend a revised buffer but cannot apply it without approval.

### Data and privacy rules

- The application is hosted on GitHub Pages.
- No personal financial data is stored in the Git repository.
- The primary remote data store is a hidden Google Drive `appDataFolder` vault made of a manifest plus two staged snapshot slots.
- IndexedDB stores a local working cache and offline queue.
- Google access tokens exist in memory only and are never placed in IndexedDB, localStorage, sessionStorage, Drive vault files, optional Sheets, or the repository.
- The Mac user account is the practical local security boundary in v1; the local cache is not encrypted at rest.
- Privacy mode visually obscures amounts but is not encryption.
- Google connection is the only account connection; there is no additional Bluehour password or PIN.

### Operational rules

- Financial history begins with the next main salary.
- Transaction entry supports both manual entry and bank/e-wallet CSV import.
- Duplicate matching is automatic for strong matches and reviewed for uncertain matches.
- Planned and actual transactions remain linked but distinct.
- Transaction splits are supported.
- Refunds and reimbursements can link to original transactions.
- Weekly account reconciliation is included.
- Daily, weekly, and salary-cycle reviews use persistent checklists.
- Records are archived by default.
- Demonstration mode uses fictional MYR data before Google is connected.

---

## 3. Experience architecture

### Primary navigation

A slim left sidebar on desktop:

1. Overview
2. Transactions
3. Plan
4. Coach
5. Budgets
6. Subscriptions
7. Net Worth
8. Review
9. Settings

Persistent controls:

- **+ Transaction** primary action
- `⌘N` new transaction
- `⌘K` command menu
- Sync status and manual sync
- Privacy mode toggle
- Profile/Google connection menu

On narrow screens, the sidebar becomes a bottom navigation bar for the five most-used destinations, with the remainder under More.

### Application states

- **Demo:** fictional local data; no Google connection.
- **Setup:** Google connected and preferences entered, waiting for the next salary start date.
- **Active online:** local data and the Google Drive app-data vault are synchronised.
- **Active offline:** local data available; changes enter the outbox.
- **Needs reconnection:** local work continues, but Google requires a new user-initiated token.
- **Conflict review:** remote and local versions of the same record require a decision.
- **Read-only recovery:** schema or sync problem detected; exports remain available while writes are paused.

---

## 4. Onboarding blueprint

### Step 1 — Welcome

Choices:

- Explore demonstration
- Continue with Google
- Set up locally first

Copy explains that the GitHub-hosted interface is public code but live profile data stays in local IndexedDB and, when connected, hidden files in the user's Google Drive app-data folder.

### Step 2 — Connect Google

- User initiates Google authorisation.
- Requested access is limited to OpenID profile metadata and `drive.appdata`.
- Bluehour creates or opens three hidden Drive app-data files: `bluehour-manifest.json`, `bluehour-slot-A.json`, and `bluehour-slot-B.json`.
- The local connection descriptor stores non-secret Drive file IDs, schema version, profile ID, and revision metadata.
- User may download a tiny connection descriptor containing the Drive vault IDs and schema version; it contains no token or secret.
- Recovery path: Continue with Google and confirm the detected Drive vault before local live data is replaced.

### Step 3 — Preferences

Defaults:

- Currency: MYR
- Locale: English (Malaysia)
- Date display: DD/MM/YYYY
- Amount display: no space after RM
- Salary window: 24–26
- Salary holiday behaviour: actual early arrival starts the new cycle immediately
- Minimum protected rate: 10%
- Buffer rule: max(RM500, 10% of remaining essential obligations)

### Step 4 — Accounts

User adds any relevant accounts and chooses:

- Name
- Type
- Role
- Institution label, optional
- Opening balance method
- Whether the account participates in weekly reconciliation

No account numbers are requested.

### Step 5 — Income

- Main salary name
- Expected net amount
- Destination account
- Usual window 24–26
- Optional variable-income sources

Variable income confidence:

- **Received:** already in an account and therefore already in balances.
- **Confirmed:** amount and expected date are known; included in projected figures.
- **Possible:** shown in scenarios but excluded from safe-to-spend.

### Step 6 — Known obligations

User adds:

- Rent/housing
- Utilities
- Internet/mobile
- Insurance
- Debt repayments
- Recurring transport
- Other fixed obligations
- Subscriptions
- Planned one-off payments

### Step 7 — Guided first budget

- Estimate essential flexible categories.
- Set or accept the 10% protected target.
- Calculate discretionary remainder.
- Show any shortfall before completion.
- Explain that the first two cycles are observational and Bluehour will suggest refinements later.

### Step 8 — Wait for next salary

Because history begins with the next salary, Bluehour enters a ready state.

When salary arrives:

1. User enters the salary deposit amount and current balance of the destination account.
2. Bluehour derives the pre-salary opening balance as `current balance − salary deposit`.
3. Bluehour creates the actual salary transaction.
4. User enters current balances for all other accounts.
5. The first salary cycle begins on that actual date.

This avoids counting the salary twice while sparing the user from remembering the exact balance immediately before it arrived.

---

## 5. Dashboard blueprint

### Header

- Current salary cycle dates
- Sync state
- Last successful save
- Privacy mode
- Quick transaction

### Hero: Safe to spend

Default period: **Until salary**.

Example:

```text
Safe to spend
RM1,842.50

RM87.74 per day until expected salary
RM920.00 reserved for essentials
Lowest projected balance: RM734.20 on 24/07/2026
Expected salary window: 24–26/07/2026
```

Period switch:

- Until salary
- This month
- Next 30 days

Companion values:

- Available from money already held
- Projected after confirmed incoming money
- Reserved for committed payments
- Reserved for essential flexible budgets
- Protected contribution remaining
- Safety buffer

Every value is clickable and opens its calculation breakdown.

### Thirty-day timeline

A horizontal or compact vertical cash-flow timeline showing:

- Current day
- Planned income
- Planned payments
- Subscription renewals
- Expected salary window
- Projected daily balance
- Lowest-balance point

The salary forecast uses the 26th as the conservative arrival date until the real salary arrives. The 24th–26th window remains visible.

### Budget section

- Category progress bars
- Remaining amount
- Percentage used
- Days left in cycle
- Near-limit and overspent states
- Move budget action when a category is overspent

### Upcoming section

- Payments due in seven days
- Annual subscription renewals due in 30 days
- Plans awaiting confirmation

### Alerts section

- Projected balance below buffer
- Uncategorised transactions
- Import matches needing review
- Offline changes waiting to sync
- Sheet not recently synchronised
- Reconciliation due

### Recent activity

- Latest transactions
- Rules applied automatically
- Budget transfers
- Reconciliation adjustments

### What changed?

Plain-language cycle comparison, for example:

- Dining is RM82.40 higher than at the same point last cycle.
- Two subscriptions renew before the next salary.
- Electricity was RM27.00 above plan.
- Protected contributions are complete for this cycle.

No pie chart is required.

---

## 6. Safe-to-spend engine

### Monetary representation

- All MYR amounts are stored as integer sen.
- `RM1,234.50` is stored as `123450`.
- Floating-point arithmetic is forbidden in domain calculations.
- Rounding occurs only when converting a percentage to sen, using a documented half-up rule.

### Date representation

- Financial dates are stored as ISO local dates: `YYYY-MM-DD`.
- Audit timestamps are stored as UTC ISO timestamps.
- Salary cycles and due dates are local-date concepts and must not be converted through browser time zones.

### Category budget modes

To avoid double-counting, every category has one reservation mode:

- **Plan-reserved:** fixed obligations are reserved from unfulfilled plans, not from a second envelope balance.
- **Envelope-reserved:** flexible categories reserve their remaining allocation.
- **No-reserve:** administrative categories such as transfers and reconciliation.
- **Protected:** reserve the uncompleted target transfer.

### Core definitions

`netSpendableBalance`

- Sum of the current economic balances of spendable accounts.
- Credit-card balances reduce this amount.
- Protected, investment, asset, and long-term liability balances are excluded.

`committedReserve`

- Unfulfilled plan-reserved payments due inside the selected horizon.
- Fulfilled, skipped, archived, or already-past plans are excluded.

`essentialEnvelopeReserve`

- For each essential envelope category, the larger of:
  - remaining allocation, or
  - specifically planned essential spending not yet completed.

This protects a known essential payment even when the category was under-budgeted.

`protectedReserve`

- The cycle's protected target minus completed protected transfers, never below zero.
- Target starts at 10% of actual deposited main salary.
- Explicit additional protected commitments are added.

`bufferReserve`

- Greater of RM500 or 10% of remaining essential obligations.

`cashCapacity`

```text
net spendable balance
+ counted future income
− committed reserve
− essential envelope reserve
− protected reserve
− buffer reserve
```

`discretionaryRemainder`

```text
discretionary allocations
+ approved budget transfers in
− approved budget transfers out
− actual discretionary spending
− explicitly reserved future discretionary plans
```

`safeToSpend`

```text
max(0, min(cashCapacity, discretionaryRemainder))
```

This final minimum is essential: Bluehour cannot declare money safe merely because cash exists when the user's discretionary budget is already exhausted.

### Available and projected values

- **Available now:** counts only balances already held. It still reserves all obligations due within the horizon.
- **Projected:** adds confirmed future income and recurring main salary when the selected horizon crosses its conservative expected date.
- **Possible income:** never increases either figure; it appears only in scenario context.

When projected salary begins a virtual future cycle inside a 30-day or calendar-month view, Bluehour copies the current approved budget template, applies the 10% protected target, and labels the result as an estimate.

### Daily amount

```text
safe to spend ÷ remaining calendar days in the selected horizon
```

- Minimum denominator: 1.
- This is guidance, not a daily envelope.

### Negative forecast behaviour

When `cashCapacity < 0`:

- Safe to spend displays RM0.00.
- Bluehour shows the shortfall and expected date.
- It identifies discretionary budgets that could be reduced.
- It suggests, but does not perform, budget transfers.
- It suggests postponing nonessential planned payments.
- Essential or protected money is never silently reclassified.

### Explainability drawer

Every safe-to-spend result includes:

- Starting account balances by account
- Included income by confidence
- Committed plans by date
- Essential envelope reserves by category
- Protected target and completed transfer
- Buffer rule and selected result
- Discretionary cap
- Any exclusions and warnings

---

## 7. Budget system

### Starter categories

#### Committed

- Housing
- Utilities
- Internet & Mobile
- Insurance
- Subscriptions
- Fixed Transport
- Debt & Contractual Payments

#### Essential flexible

- Groceries
- Fuel
- Tolls & Parking
- Transport
- Medical
- Household
- Essential Personal Care

#### Discretionary

- Dining Out
- Entertainment
- Shopping
- Hobbies
- Gifts
- Travel
- Miscellaneous

#### Protected

- Savings
- Investments
- Planned Major Payments

#### Administrative

- Bank Fees
- Taxes
- Transfers
- Reconciliation
- Uncategorised

Categories can be renamed, hidden, reordered, or created. Each category also stores an essential/discretionary/protected/administrative nature.

### Cycle behaviour

- Actual main salary arrival opens a cycle.
- The next actual main salary closes the previous cycle and opens another.
- Early holiday salary therefore closes the cycle early.
- Unused allocations expire; they do not roll forward.
- Historical allocations and results remain visible.
- Closing a cycle requires reconciliation or an explicit skip with a note.

### Overspending flow

1. Category displays a deficit.
2. Bluehour shows categories with unspent discretionary money.
3. User chooses a source, destination, and amount.
4. A budget-transfer record is created.
5. No financial account transaction is created because budget movement is an allocation decision, not movement of cash.

Committed, essential, and protected categories are not suggested as transfer sources unless the user deliberately opens an advanced override.

### First-cycle observation model

- Known committed plans are entered first.
- Essential needs are estimated.
- Protected target is reserved.
- Remaining money becomes the discretionary pool.
- After two completed cycles, Bluehour proposes revised category limits.
- Suggestions explain the observed average and variability.
- No suggestion applies itself.

---

## 8. Transaction model and entry

### Supported transaction types

- Expense
- Income
- Transfer
- Refund
- Reimbursement
- Reconciliation adjustment
- Opening balance adjustment

### Quick-entry interaction

Hybrid composer:

1. Large description field
2. Large amount field
3. Type selector
4. Account selector
5. Suggested category
6. Date, default today
7. Optional split
8. Optional note
9. Save

Defaults:

- Expense
- Today
- Last-used spending account
- Cents enabled

Conveniences:

- `⌘N` opens composer
- Repeat last transaction
- Favourite templates
- Suggested favourites: groceries, fuel, dining, tolls/parking, online shopping

### Splits

- One transaction may have multiple category splits.
- Split amounts must equal the external expense or income amount.
- Remainder is shown live.
- A one-click action assigns the remaining sen to the selected split.

### Transfers

- Transfer has at least two account legs.
- E-wallet top-ups are transfers, not expenses.
- Credit-card payments are transfers from a bank account to the credit-card liability.
- Transfer fees, when present, are a separate expense split in the same compound transaction.

### Planned versus actual

- Planned transactions are stored as plan instances.
- Actual transactions are ledger records.
- Fulfilment links the two rather than replacing either.
- The comparison keeps expected amount/date and actual amount/date.
- Variance is available in reviews.
- Pending bank-card transactions are not a first-class v1 state.

### Refunds and reimbursements

- Link to the original transaction when possible.
- Reverse the relevant category spending for budget reporting.
- Credit the destination account.
- Preserve the original record.

### Archiving

- Archive is the standard removal action.
- Archived records remain in history but are excluded from active views and calculations.
- v1 provides no casual permanent-delete command.

---

## 9. Automatic categorisation

### Rule flow

1. Imported or entered description is normalised.
2. Approved rules are evaluated by priority.
3. Matching category is applied automatically.
4. The transaction enters a review queue marked with the rule used.
5. Corrections can revise, disable, or leave the rule unchanged.

### Rule types

- Exact merchant
- Description contains
- Description begins with
- Account plus description
- Amount range plus description
- Regular expression, advanced only

### Rule proposal

Bluehour may propose a rule after repeated consistent categorisation, such as three transactions with the same normalised merchant. The user must approve the proposed rule.

### Rule safeguards

- A rule preview shows recent transactions it would have matched.
- High-priority specific rules beat broad rules.
- Rule changes never rewrite historical categorisation silently.
- An optional action can deliberately apply a rule to selected historical records.

---

## 10. CSV import and duplicate matching

### Import wizard

1. Choose target account.
2. Select CSV file.
3. Detect delimiter and encoding.
4. Preview rows locally.
5. Map columns:
   - date
   - description
   - debit
   - credit
   - signed amount
   - optional balance
   - optional bank reference
6. Confirm date and sign conventions.
7. Save reusable import profile.
8. Run duplicate analysis.
9. Review uncertain matches.
10. Import.

### Privacy

- CSV content is parsed in the browser.
- Raw files are not uploaded to Google or retained locally.
- Only normalised records and an import-batch summary are saved.

### Duplicate strategy

Strong match signals:

- Same source reference, when available
- Same target account
- Same amount
- Same or adjacent transaction date
- High similarity of normalised description
- Existing transaction already linked to the same import fingerprint

Outcomes:

- **Strong:** link automatically.
- **Uncertain:** review queue.
- **New:** import as actual transaction.

Nothing is deleted automatically.

### Import reversibility

Each transaction records its import-batch ID. The user can archive all records from an erroneous batch after confirmation.

### Optional Sheet and CSV injection safety

- Optional Google Sheet export writes raw values rather than user-entered formula parsing.
- Exported text beginning with formula-trigger characters is escaped.
- Imported text is treated as data, never executable formula content.

---

## 11. Planning, recurrence, and subscriptions

### Plan screen

Views:

- Timeline
- Calendar
- Recurring templates
- Income forecast
- Planned payments

### Recurring templates

Support:

- Weekly
- Monthly
- Quarterly
- Yearly
- Custom interval
- End date, optional
- Fixed amount
- Estimated amount
- Account and category
- Essential/discretionary flag

Recurring templates generate plan instances ahead of time.

### Main salary recurrence

- Expected window start day: 24
- Expected window end day: 26
- Conservative forecast date: 26
- An actual earlier deposit supersedes the forecast and opens the next cycle.

### Planned one-off payments

Fields:

- Name
- Expected amount
- Due date
- Account
- Category
- Essential/discretionary
- Reserved or informational
- Notes

Sinking-fund automation is deferred. Planned payments due after the next salary appear as warnings but do not reduce the current cycle's safe-to-spend unless deliberately reserved now.

### Subscriptions

Fields:

- Provider
- Amount
- Billing frequency
- Next payment date
- Annual renewal date
- Payment account
- Category
- Essential or optional
- Start date
- Cancellation deadline, optional
- Notes
- Price history
- Value rating
- Last reviewed date
- Review status: active, paused, archived

Alerts:

- Any payment due within seven days
- Annual renewal due within 30 days

Annual subscriptions show monthly equivalent cost, but v1 does not automatically create a monthly sinking fund.

### Savings Coach

Savings Coach is deterministic, local-only educational guidance. It never calls external services and never applies financial actions automatically.

Primary workflows:

- Spending Leak Detector for category pacing, cycle increases, small purchase clusters, merchant concentration, merchant watchlist matches, subscription reviews, new recurring costs, and extra-income spend-through.
- Can I Buy This? purchase checks against safe-to-spend and category remaining amounts.
- Savings Goals with manual, protected-transfer, Save-the-Difference, extra-income, and cycle-close contribution sources.
- Save-the-Difference suggestions from underspent discretionary envelopes.
- Subscription Optimiser value/status review.
- End-of-Cycle Savings Review.

Savings Coach persists goals, contributions, insight decisions, and purchase checks only after explicit user action. Budget transfers, categorisation rules, reconciliation adjustments, buffer changes, savings contributions, subscription status changes, and sync conflicts still require explicit approval.

---

## 12. Reconciliation and reviews

### Weekly reconciliation

For each enabled account:

1. Show calculated balance.
2. Ask for current institution balance.
3. Display difference.
4. Help search for missing or duplicated transactions.
5. If unresolved, offer a clearly labelled reconciliation adjustment with a required note.

No balance is silently overwritten.

### Daily review

Checklist:

- Review uncategorised transactions
- Confirm due plans
- Inspect import-rule actions
- Resolve failed sync items

### Weekly review

Checklist:

- Reconcile accounts
- Resolve uncategorised transactions
- Review overspending
- Inspect next 30 days
- Confirm upcoming payments
- Review sync and backup status

### Salary-cycle close

Checklist:

- Reconcile all accounts
- Resolve incomplete plans
- Review planned-versus-actual variance
- Review category results
- Confirm protected contribution
- Archive or carry forward future plans as appropriate
- Download or confirm backup
- Close cycle
- Create next cycle budget from the approved template

Checklist progress persists.

---

## 13. Net worth

### Account tracking modes

- **Ledger:** bank, cash, e-wallet, credit card.
- **Manual snapshot:** investments, property, vehicles, long-term liabilities.
- **Hybrid:** user may keep transactions and occasionally replace calculated value with an approved valuation snapshot.

### Net-worth calculation

```text
spendable assets
+ protected assets
+ investments
+ property and vehicle values
− liabilities
```

### v1 display

- Current net worth
- Asset and liability totals
- History by valuation snapshot
- Account list
- Last valuation date

Individual holdings, gains, losses, and live prices are deferred.

---

## 14. Alerts

In-app alerts only:

- Payment due within seven days
- Annual subscription renewal due within 30 days
- Projected balance below buffer
- Safe-to-spend reduced to zero
- Category near limit
- Category overspent
- Uncategorised transactions
- Import matches needing review
- Reconciliation due
- Google authorisation required
- Local changes waiting to sync
- Drive vault not recently synchronised
- Backup due at cycle close

Default near-limit threshold: 80%, configurable.

---

## 15. Visual system

### Tone

- Calm
- Elegant
- Spacious
- Modern banking application
- No gamification

### Colour direction

- Deep navy for navigation and primary action
- Cool greys for backgrounds, borders, and secondary text
- White surfaces
- Green only for healthy/complete states
- Amber for attention
- Red for shortfall or destructive actions

Exact colour tokens are chosen during implementation and checked for accessible contrast.

### Typography

- Apple system font stack
- Tabular numerals for financial amounts
- Large hero amount
- Right-aligned amounts in tables
- Sentence case labels

### Components

- Sidebar
- Top bar
- Summary card
- Breakdown drawer
- Data table
- Filter bar
- Progress bar
- Timeline
- Alert banner
- Transaction composer
- Command menu
- Review checklist
- Empty state
- Offline/sync badge

### Motion

- Brief and restrained
- Reduced-motion preference respected
- No animated totals that obscure the final value

### Privacy mode

- Toolbar button and keyboard command
- Replaces monetary figures with neutral blocks or dots
- Remains active across navigation
- Automatically disables on full reload unless later configured otherwise
- Clearly described as visual concealment, not encryption

---

## 16. Technical architecture

### Front end

Recommended stack:

- React
- TypeScript in strict mode
- Vite
- React Router with hash routing for reliable GitHub Pages navigation
- IndexedDB through a small typed database wrapper
- Zod or equivalent runtime validation at storage and API boundaries
- A lightweight form library for complex transaction and onboarding forms
- A local date utility library
- A dedicated CSV parser
- Vitest for unit/integration tests
- Playwright for end-to-end tests

Versions are locked when construction begins rather than hard-coded in this document.

### Hosting

- GitHub Pages serves the built static files.
- GitHub Actions runs linting, tests, build, and deployment.
- Vite `base` is configured for the final repository path.
- No source map containing real data exists; test fixtures are fictional.
- The deployed site is public, even if the source repository is private.

### Safari web app

- Web application manifest supplies name, icon, theme, and standalone display preferences.
- Service worker caches the application shell for offline launch.
- The user adds the site to the Dock through Safari.
- No beta-only macOS API is required.

### Storage abstraction

Domain code depends on repository interfaces, not remote providers directly.

```text
Domain services
    ↓
Repository interfaces
    ├── Local IndexedDB repository
    ├── Google Drive app-data vault adapter
    ├── Optional Google Sheets export adapter
    └── Future Supabase adapter
```

This is the principal safeguard against a painful future migration.

### Suggested source layout

```text
src/
  app/
    routes/
    shell/
    providers/
  domain/
    money/
    accounts/
    transactions/
    budgets/
    forecasting/
    plans/
    reconciliation/
  features/
    onboarding/
    dashboard/
    transaction-entry/
    transactions/
    imports/
    budgets/
    subscriptions/
    net-worth/
    reviews/
    settings/
  data/
    local-db/
    repositories/
    google-auth/
    google-sheets/
    sync/
    migrations/
  ui/
    components/
    tokens/
    icons/
  test/
    fixtures/
    builders/
```

---

## 17. Google authorisation and Sheet design

### Authorisation

- Google Identity Services token model.
- Requested scopes:
  - `drive.file`
  - basic identity scopes needed to recognise the selected account
- No client secret in the browser.
- OAuth access token remains in memory only.
- Token expiry changes sync state to **Reconnect Google**.
- A new token request follows a deliberate user action.
- Offline work remains in the outbox until reconnection.

### Important local-security limitation

Because offline use is enabled and no local passphrase was selected, real data in IndexedDB is protected primarily by the user's macOS account and browser sandbox. Google authorisation protects Sheet access but is not encryption for the local cache. This trade-off is accepted for v1 and must be stated during onboarding.

### Spreadsheet tabs

1. `Meta`
2. `Accounts`
3. `BalanceSnapshots`
4. `Transactions`
5. `TransactionLegs`
6. `TransactionSplits`
7. `Categories`
8. `BudgetCycles`
9. `BudgetAllocations`
10. `BudgetTransfers`
11. `RecurringRules`
12. `PlanInstances`
13. `Subscriptions`
14. `CategorisationRules`
15. `ImportProfiles`
16. `ImportBatches`
17. `Reconciliations`
18. `ReviewSessions`
19. `Settings`

The Sheet is readable for recovery but treated as app-managed. Headers are frozen and protected where practical. A first tab explains that ordinary editing should occur in Bluehour.

### Record metadata

Every durable record has:

- `id`
- `createdAt`
- `updatedAt`
- `archivedAt`, nullable
- `revision`
- `lastModifiedByClientId`

### Sheet write policy

- New rows append.
- Existing rows update by stable ID after the current row map is refreshed.
- Multiple writes use batched requests.
- Values are written as raw data.
- Rows are never physically deleted during normal use.
- Schema version is stored in `Meta`.

---

## 18. Local database and synchronisation

### Local stores

- All domain entities
- Outbox operations
- Sync cursor and remote revision
- Conflict records
- Cached calculations
- UI preferences
- Demo profile, isolated from real profile

### Mutation sequence

1. Validate command.
2. Write domain record and outbox operation in one local database transaction.
3. Recalculate affected summaries.
4. Update UI immediately.
5. Attempt remote sync when authorised and online.

### Pull/push strategy

- `Meta` holds a remote revision number.
- Bluehour checks the remote revision before a sync.
- If no other remote change exists, it batches pending writes.
- If the remote revision advanced, it pulls affected tables, validates them, and merges by stable ID and revision.
- A record modified both locally and remotely since the last common revision becomes a conflict.
- Conflicts are never resolved by silent last-write-wins for financial records.

### Conflict screen

Shows:

- Local version
- Remote Drive vault version
- Field differences
- Choose local
- Choose remote
- Merge selected fields when safe

### Sync indicators

- Saved locally
- Waiting to sync
- Syncing
- Synced at [time]
- Reconnect Google
- Conflict requires review
- Sync failed, retry available

### Resilience

- Failed writes remain in the outbox.
- Retrying an operation is idempotent by operation ID.
- App update migrations run before normal writes.
- If validation fails, Bluehour enters read-only recovery mode and offers export.

---

## 19. Core data model

### Account

```text
id
name
type: bank | savings | cash | ewallet | credit_card | loan | investment | property | vehicle | other
role: spendable | protected | investment | asset | liability
trackingMode: ledger | manual_snapshot | hybrid
currency: MYR
institutionLabel?
reconcileWeekly
sortOrder
createdAt
updatedAt
archivedAt?
revision
```

### BalanceSnapshot

```text
id
accountId
asOfDate
amountMinor
source: opening | reconciliation | manual_valuation | import
note?
createdAt
updatedAt
archivedAt?
revision
```

### Transaction

```text
id
type: expense | income | transfer | refund | reimbursement | reconciliation_adjustment | opening_adjustment
status: actual
occurredOn
description
merchantNormalized?
note?
source: manual | csv_import | recurring_confirmation | reconciliation
planInstanceId?
refundOfTransactionId?
importBatchId?
importFingerprint?
createdAt
updatedAt
archivedAt?
revision
```

### TransactionLeg

Represents the economic change to an account.

```text
id
transactionId
accountId
deltaMinor
createdAt
updatedAt
archivedAt?
revision
```

Examples:

- RM20 cash expense: cash leg `-2000`.
- RM100 salary: bank leg `+10000`.
- RM50 bank-to-wallet transfer: bank `-5000`, wallet `+5000`.
- RM100 credit-card purchase: card liability leg `-10000`.
- RM100 card payment: bank `-10000`, card liability `+10000`.

### TransactionSplit

```text
id
transactionId
categoryId
direction: expense | income | reversal
amountMinor
createdAt
updatedAt
archivedAt?
revision
```

### Category

```text
id
name
group: committed | essential_flexible | discretionary | protected | administrative
nature: essential | discretionary | protected | administrative
reservationMode: plan | envelope | protected | none
iconKey?
sortOrder
active
createdAt
updatedAt
archivedAt?
revision
```

### BudgetCycle

```text
id
startedOn
endedOn?
status: setup | open | closing | closed
salaryTransactionId
expectedNextSalaryFrom
expectedNextSalaryTo
protectedRateBasisPoints
bufferMinimumMinor
bufferEssentialRateBasisPoints
closedAt?
createdAt
updatedAt
archivedAt?
revision
```

### BudgetAllocation

```text
id
budgetCycleId
categoryId
baseAmountMinor
note?
createdAt
updatedAt
archivedAt?
revision
```

### BudgetTransfer

```text
id
budgetCycleId
fromCategoryId
toCategoryId
amountMinor
occurredOn
note?
createdAt
updatedAt
archivedAt?
revision
```

### RecurringRule

```text
id
name
kind: income | expense | transfer | subscription
frequency: weekly | monthly | quarterly | yearly | custom
interval
startDate
endDate?
dayOfMonth?
windowStartDay?
windowEndDay?
amountMode: fixed | estimated
amountMinor
fromAccountId?
toAccountId?
categoryId?
essential
active
createdAt
updatedAt
archivedAt?
revision
```

### PlanInstance

```text
id
recurringRuleId?
kind: income | expense | transfer
name
expectedDate
windowStartDate?
windowEndDate?
expectedAmountMinor
confidence: expected | confirmed | possible
reservation: reserved | informational
status: scheduled | fulfilled | skipped | archived
linkedTransactionId?
createdAt
updatedAt
archivedAt?
revision
```

### Subscription

```text
id
recurringRuleId
provider
billingFrequency
nextPaymentDate
annualRenewalDate?
cancellationDeadline?
essential
notes?
createdAt
updatedAt
archivedAt?
revision
```

### CategorisationRule

```text
id
name
priority
matchField
operator: exact | contains | starts_with | regex | amount_range
pattern
accountId?
categoryId
autoApply
active
hitCount
lastUsedAt?
createdAt
updatedAt
archivedAt?
revision
```

### ImportProfile

```text
id
name
accountId
delimiter
encoding
dateFormat
columnMappingJson
signRulesJson
createdAt
updatedAt
archivedAt?
revision
```

### ImportBatch

```text
id
importProfileId
fileName
fileHash
importedAt
rowCount
newCount
matchedCount
reviewCount
createdAt
updatedAt
archivedAt?
revision
```

### Reconciliation

```text
id
accountId
asOfDate
calculatedBalanceMinor
statedBalanceMinor
differenceMinor
status: matched | resolved | adjusted | skipped
adjustmentTransactionId?
note?
createdAt
updatedAt
archivedAt?
revision
```

### ReviewSession

```text
id
type: daily | weekly | cycle_close
periodKey
status: open | completed | skipped
itemsJson
completedAt?
createdAt
updatedAt
archivedAt?
revision
```

---

## 20. Backup and export

### Encrypted JSON backup

Contains:

- Schema version
- Export timestamp
- All non-demo domain entities
- User settings
- Integrity manifest

Encryption:

- User-provided export passphrase
- Browser Web Crypto
- Password-derived key with random salt
- Authenticated encryption with random nonce
- Versioned envelope so parameters can evolve

The passphrase is never stored and cannot be recovered.

### CSV exports

Separate readable files for:

- Accounts
- Transactions
- Splits
- Budgets
- Plans
- Subscriptions
- Net-worth snapshots

CSV export is not encrypted; Bluehour displays a warning before download.

### Backup reminders

- At each cycle close
- When no successful backup has occurred for a configurable period
- Manual backup command always available

---

## 21. Accessibility and keyboard behaviour

- Full keyboard navigation
- Visible focus states
- Semantic labels for forms and amounts
- Status never conveyed through colour alone
- Sufficient contrast
- Screen-reader text for trend icons
- Reduced-motion support
- `Esc` closes drawers and dialogs where safe
- Unsaved forms warn before closing
- Destructive archive actions require explicit confirmation when consequences are broad

Primary shortcuts:

- `⌘N`: new transaction
- `⌘K`: command menu
- `⌘⇧P`: privacy mode
- `/`: focus transaction search when appropriate

---

## 22. Testing strategy

### Unit tests

Mandatory domain coverage:

- Money parsing and formatting
- Integer-sen percentage rounding
- Safe-to-spend formula
- No double-counting of committed plans and envelopes
- Buffer calculation
- Protected target calculation
- Salary-cycle boundaries
- Early salary arrival
- Negative forecast behaviour
- Transfers and credit-card balance effects
- Split validation
- Refund category reversal
- Budget transfers
- Recurrence generation
- Duplicate matching scores

### Property/invariant tests

- Transaction split total equals required amount.
- Transfer account legs sum to zero, excluding explicit fee expense.
- Archived records do not affect active calculations.
- Safe-to-spend is never negative.
- Safe-to-spend never exceeds discretionary remainder.
- Re-running a sync operation does not duplicate records.
- Currency amounts remain integers.

### Integration tests

- IndexedDB migrations
- Outbox transactionality
- Google API adapter with mocked responses
- Token expiry and reconnection
- Pull/merge/push
- Conflict creation
- CSV profile mapping
- Import rollback by archive
- Encrypted backup round-trip

### End-to-end tests

- Explore demo
- Complete onboarding
- Start first cycle on salary arrival
- Enter and split an expense
- Import CSV and resolve duplicates
- Approve categorisation rule
- Overspend and move budget
- Fulfil a planned bill with different actual amount
- Work offline and later sync
- Reconcile account
- Close salary cycle
- Restore encrypted backup
- Use privacy mode

### Test data

All fixtures use fictional institutions, merchants, and MYR amounts. No user data enters tests, logs, screenshots, or the repository.

---

## 23. Acceptance criteria for v1

The release is acceptable when:

1. A first-time user can explore demo mode without Google.
2. The user can connect Google and create or reconnect to one private Bluehour Sheet.
3. No financial record or token is stored in the Git repository.
4. The user can start a salary cycle on actual salary arrival.
5. Safe-to-spend passes all agreed calculation scenarios and exposes a full breakdown.
6. Manual transaction entry, splits, transfers, refunds, and archive work.
7. CSV import supports reusable mappings and duplicate review.
8. Approved categorisation rules auto-apply and remain reviewable.
9. Salary-cycle budgets expire unused allocations and support approved budget transfers.
10. Recurring payments, planned payments, and subscriptions feed the forecast.
11. Payment and renewal alerts appear at the agreed thresholds.
12. Offline mutations persist and synchronise without duplication.
13. Sync failures are visible and never represented as success.
14. Weekly reconciliation can create a labelled adjustment only after user approval.
15. Salary-cycle close preserves planned-versus-actual variance.
16. Investment, property, vehicle, and liability snapshots contribute to net worth but not safe-to-spend.
17. Encrypted JSON backup can be restored and verified.
18. CSV exports are readable and formula-injection-safe.
19. The interface works as a Safari Dock web app and adapts to a narrow phone viewport.
20. Keyboard navigation and privacy mode work throughout the main flows.

---

## 24. Delivery sequence

### Phase 1 — Foundation and demonstration

- Project scaffold
- Design tokens and application shell
- Hash routing
- Domain money/date utilities
- Local database
- Fictional demo dataset
- Overview shell
- Automated test and deployment pipeline

**Milestone:** installable demo opens from GitHub Pages and the Dock.

### Phase 2 — Accounts and transactions

- Onboarding shell
- Account management
- Opening-balance workflow
- Quick transaction composer
- Legs, splits, transfers, refunds
- Transaction table, search, filters, archive

**Milestone:** fully usable local transaction ledger.

### Phase 3 — Salary cycles, budgets, and safe-to-spend

- Salary-cycle engine
- Category model
- Budget allocations and transfers
- Protected target
- Buffer
- Safe-to-spend service and explanation drawer
- Dashboard budget components

**Milestone:** the three core financial questions are answered locally.

### Phase 4 — Plans, subscriptions, and forecast

- Recurring rules
- Plan instances
- Salary window logic
- Planned-versus-actual fulfilment
- Subscription tracker
- Thirty-day timeline
- Alerts

**Milestone:** forward cash-flow view is operational.

### Phase 5 — Imports, rules, and reviews

- CSV mapping wizard
- Duplicate matcher
- Categorisation rules and review queue
- Reconciliation
- Daily/weekly/cycle-close checklists
- What changed summary

**Milestone:** sustainable weekly operation without excessive manual cleanup.

### Phase 6 — Google Drive vault synchronisation

- Google authorisation
- Drive app-data vault creation and recovery
- Manifest and staged slot schema creation
- Local outbox
- Pull/push merge
- Conflict review
- Optional Google Sheet inspection export
- Sync status and resilience

**Milestone:** Drive app-data vault becomes the private remote store.

### Phase 7 — Net worth, backup, and polish

- Manual valuation snapshots
- Net-worth page
- Encrypted JSON backup and restore
- CSV export
- Privacy mode
- Responsive refinement
- Accessibility audit
- Performance and error-state hardening

**Milestone:** v1 release candidate.

---

## 25. Recommended first coding target

The first implementation slice should deliberately avoid Google integration. It should prove the most important logic with fictional data:

1. Application shell and visual system
2. Local database
3. Accounts
4. Transactions and splits
5. Salary cycle
6. Budgets
7. Safe-to-spend calculation and explanation
8. Demo dashboard

Only after these domain rules are tested should remote synchronisation be added. A cloud connection cannot rescue a faulty financial calculation; it merely synchronises the fault with impressive efficiency.

---

## 26. Deferred migration to Supabase

The repository layer makes a later Supabase adapter possible without changing domain calculations or screens.

Migration plan:

- Map stable UUID records to relational tables.
- Retain integer minor-unit amounts and ISO local dates.
- Add Supabase authentication.
- Apply Row Level Security to every user-owned table.
- Import from the Drive vault snapshot or optional Google Sheet export using the same schema version and validators.
- Keep Google Sheet export as a portability feature.

Supabase should be considered when one or more of these becomes necessary:

- Reliable background notifications
- Multiple devices with frequent concurrent editing
- Multiple users
- Large data volume
- Server-side jobs
- Stronger audit and conflict handling

Until then, the Drive app-data vault architecture is sufficient for a one-user application provided the limitations above remain visible.

---

## 27. Build decision

**Bluehour v1 is ready to build.** No unresolved product question blocks Phase 1. The name remains a replaceable working name until the user decides to perform formal domain or trademark clearance.
