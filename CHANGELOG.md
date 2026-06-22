# Changelog

## 1.0.0-rc.1

- Salary-boundary forecast correction: payday is owned by the future salary cycle, the current projected segment ends the day before payday, projected salary is applied once, and cross-cycle buffers are reported per segment instead of being added together as a cash outflow.
- Full reserve-aware cash-flow projection: the timeline now uses domain-level projected cash events for confirmed income, projected salary, committed plans, subscriptions, essential plans, deterministic undated essential distributions, discretionary reservations, protected-transfer assumptions, and net-spendable transfer impacts.
- Import duplicate audit trail: every normalized CSV row receives a typed audit outcome, strong matches link without creating transactions, uncertain matches persist ranked candidate transaction IDs and scores, and user decisions survive reload.
- RC test and Safari/WebKit hardening: Playwright now includes WebKit critical flows, route-level lazy loading removes the main chunk warning without changing `chunkSizeWarningLimit`, and documentation has been updated for the release-candidate gate.
