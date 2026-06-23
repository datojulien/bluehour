import type {
  Account,
  BalanceSnapshot,
  BluehourSnapshot,
  BudgetAllocation,
  BudgetCycle,
  BudgetTransfer,
  CategorisationRule,
  Category,
  ConflictRecord,
  AppSettings,
  ImportBatch,
  ImportProfile,
  ImportRowAudit,
  IsoDate,
  OutboxOperation,
  PlanInstance,
  Reconciliation,
  ReviewSession,
  RecurringRule,
  SyncState,
  Subscription,
  Transaction,
  TransactionLeg,
  TransactionSplit
} from "../../domain/types";

const now = "2026-07-12T08:00:00.000Z";

function meta(id: string) {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    revision: 1
  };
}

export const demoAsOfDate: IsoDate = "2026-07-12";

export function createDemoSnapshot(): BluehourSnapshot {
  const accounts: Account[] = [
    {
      ...meta("acc-meranti-current"),
      name: "Meranti Current",
      type: "bank",
      role: "spendable",
      trackingMode: "ledger",
      currency: "MYR",
      institutionLabel: "Meranti Bank",
      reconcileWeekly: true,
      sortOrder: 1
    },
    {
      ...meta("acc-harbour-wallet"),
      name: "Harbour Wallet",
      type: "ewallet",
      role: "spendable",
      trackingMode: "ledger",
      currency: "MYR",
      institutionLabel: "Harbour Pay",
      reconcileWeekly: true,
      sortOrder: 2
    },
    {
      ...meta("acc-rainstone-card"),
      name: "Rainstone Card",
      type: "credit_card",
      role: "liability",
      trackingMode: "ledger",
      currency: "MYR",
      institutionLabel: "Rainstone Credit",
      reconcileWeekly: true,
      sortOrder: 3
    },
    {
      ...meta("acc-blue-jar-savings"),
      name: "Blue Jar Savings",
      type: "savings",
      role: "protected",
      trackingMode: "ledger",
      currency: "MYR",
      institutionLabel: "Meranti Bank",
      reconcileWeekly: false,
      sortOrder: 4
    },
    {
      ...meta("acc-klang-index"),
      name: "Klang Index Fund",
      type: "investment",
      role: "investment",
      trackingMode: "manual_snapshot",
      currency: "MYR",
      institutionLabel: "Klang Invest",
      reconcileWeekly: false,
      sortOrder: 5
    }
  ];

  const balanceSnapshots: BalanceSnapshot[] = [
    {
      ...meta("bal-current-opening"),
      accountId: "acc-meranti-current",
      asOfDate: "2026-06-23",
      amountMinor: 150_000,
      source: "opening",
      note: "Fictional opening balance before salary."
    },
    {
      ...meta("bal-wallet-opening"),
      accountId: "acc-harbour-wallet",
      asOfDate: "2026-06-23",
      amountMinor: 18_000,
      source: "opening"
    },
    {
      ...meta("bal-card-opening"),
      accountId: "acc-rainstone-card",
      asOfDate: "2026-06-23",
      amountMinor: -42_000,
      source: "opening"
    },
    {
      ...meta("bal-savings-opening"),
      accountId: "acc-blue-jar-savings",
      asOfDate: "2026-06-23",
      amountMinor: 1_200_000,
      source: "opening"
    },
    {
      ...meta("bal-investment-opening"),
      accountId: "acc-klang-index",
      asOfDate: "2026-06-23",
      amountMinor: 500_000,
      source: "manual_valuation"
    }
  ];

  const categories: Category[] = [
    category("cat-housing", "Housing", "committed", "essential", "plan", 1),
    category("cat-utilities", "Utilities", "committed", "essential", "plan", 2),
    category("cat-internet-mobile", "Internet & Mobile", "committed", "essential", "plan", 3),
    category("cat-insurance", "Insurance", "committed", "essential", "plan", 4),
    category("cat-subscriptions", "Subscriptions", "committed", "discretionary", "plan", 5),
    category("cat-fixed-transport", "Fixed Transport", "committed", "essential", "plan", 6),
    category("cat-groceries", "Groceries", "essential_flexible", "essential", "envelope", 7),
    category("cat-fuel", "Fuel", "essential_flexible", "essential", "envelope", 8),
    category("cat-transport", "Transport", "essential_flexible", "essential", "envelope", 9),
    category("cat-tolls-parking", "Tolls & Parking", "essential_flexible", "essential", "envelope", 10),
    category("cat-household", "Household", "essential_flexible", "essential", "envelope", 11),
    category("cat-essential-personal-care", "Essential Personal Care", "essential_flexible", "essential", "envelope", 12),
    category("cat-dining", "Dining Out", "discretionary", "discretionary", "envelope", 13),
    category("cat-entertainment", "Entertainment", "discretionary", "discretionary", "envelope", 14),
    category("cat-shopping", "Shopping", "discretionary", "discretionary", "envelope", 15),
    category("cat-travel", "Travel", "discretionary", "discretionary", "envelope", 16),
    category("cat-hobbies", "Hobbies", "discretionary", "discretionary", "envelope", 17),
    category("cat-gifts", "Gifts", "discretionary", "discretionary", "envelope", 18),
    category("cat-miscellaneous", "Miscellaneous", "discretionary", "discretionary", "envelope", 19),
    category("cat-savings", "Savings", "protected", "protected", "protected", 20),
    category("cat-investments", "Investments", "protected", "protected", "protected", 21),
    category("cat-planned-major-payments", "Planned Major Payments", "protected", "protected", "protected", 22),
    category("cat-transfers", "Transfers", "administrative", "administrative", "none", 23),
    category("cat-income", "Income", "administrative", "administrative", "none", 24),
    category("cat-reconciliation", "Reconciliation", "administrative", "administrative", "none", 25),
    category("cat-uncategorised", "Uncategorised", "administrative", "administrative", "none", 26),
    category("cat-bank-fees", "Bank Fees", "administrative", "administrative", "none", 27),
    category("cat-taxes", "Taxes", "administrative", "administrative", "none", 28)
  ];

  const budgetCycles: BudgetCycle[] = [
    {
      ...meta("cycle-2026-06-24"),
      startedOn: "2026-06-24",
      status: "open",
      salaryTransactionId: "txn-salary-june",
      expectedNextSalaryFrom: "2026-07-24",
      expectedNextSalaryTo: "2026-07-26",
      protectedRateBasisPoints: 1_000,
      bufferMinimumMinor: 50_000,
      bufferEssentialRateBasisPoints: 1_000,
      actualMainSalaryMinor: 780_000
    }
  ];

  const budgetAllocations: BudgetAllocation[] = [
    allocation("alloc-housing", "cat-housing", 220_000),
    allocation("alloc-utilities", "cat-utilities", 16_000),
    allocation("alloc-internet-mobile", "cat-internet-mobile", 9_800),
    allocation("alloc-insurance", "cat-insurance", 18_000),
    allocation("alloc-subscriptions", "cat-subscriptions", 3_900),
    allocation("alloc-groceries", "cat-groceries", 90_000),
    allocation("alloc-fuel", "cat-fuel", 30_000),
    allocation("alloc-transport", "cat-transport", 20_000),
    allocation("alloc-household", "cat-household", 25_000),
    allocation("alloc-dining", "cat-dining", 70_000),
    allocation("alloc-entertainment", "cat-entertainment", 30_000),
    allocation("alloc-shopping", "cat-shopping", 40_000)
  ];

  const budgetTransfers: BudgetTransfer[] = [
    {
      ...meta("transfer-entertainment-to-dining"),
      budgetCycleId: "cycle-2026-06-24",
      fromCategoryId: "cat-entertainment",
      toCategoryId: "cat-dining",
      amountMinor: 10_000,
      occurredOn: "2026-07-05",
      note: "Approved demo transfer after two meals out."
    }
  ];

  const transactions: Transaction[] = [
    transaction("txn-salary-june", "income", "2026-06-24", "Main salary", "manual"),
    transaction("txn-rent", "expense", "2026-06-25", "Vista Heights rent", "manual", "plan-rent"),
    transaction("txn-savings-transfer", "transfer", "2026-06-25", "Protected savings transfer", "manual"),
    transaction("txn-card-payment", "transfer", "2026-06-26", "Rainstone card payment", "manual"),
    transaction("txn-groceries-card", "expense", "2026-06-29", "Banyan Market groceries", "manual"),
    transaction("txn-groceries-current", "expense", "2026-07-03", "Tamarind Fresh groceries", "manual"),
    transaction("txn-fuel", "expense", "2026-07-04", "Lumen Fuel", "manual"),
    transaction("txn-dining", "expense", "2026-07-06", "Saffron Lane lunch", "manual"),
    transaction("txn-streaming", "expense", "2026-07-07", "Orchid Stream", "manual"),
    transaction("txn-wallet-topup", "transfer", "2026-07-08", "Harbour Wallet top-up", "manual"),
    transaction("txn-tolls", "expense", "2026-07-09", "City tolls", "manual"),
    transaction("txn-shopping", "expense", "2026-07-10", "Northstar Supplies", "manual"),
    {
      ...transaction("txn-shopping-refund", "refund", "2026-07-11", "Northstar Supplies refund", "manual"),
      refundOfTransactionId: "txn-shopping"
    }
  ];

  const transactionLegs: TransactionLeg[] = [
    leg("leg-salary-current", "txn-salary-june", "acc-meranti-current", 780_000),
    leg("leg-rent-current", "txn-rent", "acc-meranti-current", -220_000),
    leg("leg-savings-current", "txn-savings-transfer", "acc-meranti-current", -80_000),
    leg("leg-savings-protected", "txn-savings-transfer", "acc-blue-jar-savings", 80_000),
    leg("leg-card-payment-current", "txn-card-payment", "acc-meranti-current", -42_000),
    leg("leg-card-payment-card", "txn-card-payment", "acc-rainstone-card", 42_000),
    leg("leg-groceries-card", "txn-groceries-card", "acc-rainstone-card", -15_680),
    leg("leg-groceries-current", "txn-groceries-current", "acc-meranti-current", -18_450),
    leg("leg-fuel-current", "txn-fuel", "acc-meranti-current", -11_800),
    leg("leg-dining-current", "txn-dining", "acc-meranti-current", -3_720),
    leg("leg-streaming-card", "txn-streaming", "acc-rainstone-card", -8_990),
    leg("leg-wallet-topup-current", "txn-wallet-topup", "acc-meranti-current", -10_000),
    leg("leg-wallet-topup-wallet", "txn-wallet-topup", "acc-harbour-wallet", 10_000),
    leg("leg-tolls-wallet", "txn-tolls", "acc-harbour-wallet", -6_400),
    leg("leg-shopping-current", "txn-shopping", "acc-meranti-current", -12_600),
    leg("leg-shopping-refund-current", "txn-shopping-refund", "acc-meranti-current", 3_000)
  ];

  const transactionSplits: TransactionSplit[] = [
    split("split-salary", "txn-salary-june", "cat-income", "income", 780_000),
    split("split-rent", "txn-rent", "cat-housing", "expense", 220_000),
    split("split-groceries-card", "txn-groceries-card", "cat-groceries", "expense", 15_680),
    split("split-groceries-current", "txn-groceries-current", "cat-groceries", "expense", 18_450),
    split("split-fuel", "txn-fuel", "cat-fuel", "expense", 11_800),
    split("split-dining", "txn-dining", "cat-dining", "expense", 3_720),
    split("split-streaming", "txn-streaming", "cat-entertainment", "expense", 8_990),
    split("split-tolls", "txn-tolls", "cat-transport", "expense", 6_400),
    split("split-shopping", "txn-shopping", "cat-shopping", "expense", 12_600),
    split("split-shopping-refund", "txn-shopping-refund", "cat-shopping", "reversal", 3_000)
  ];

  const planInstances: PlanInstance[] = [
    plan("plan-insurance", "expense", "Insurance premium", "2026-07-16", 18_000, "cat-insurance", "confirmed", true),
    plan("plan-weekend-cinema", "expense", "Weekend cinema", "2026-07-18", 8_500, "cat-entertainment", "expected", false),
    plan("plan-freelance", "income", "Confirmed freelance payment", "2026-07-19", 35_000, undefined, "confirmed", false),
    plan("plan-mobile", "expense", "Mobile plan", "2026-07-20", 9_800, "cat-internet-mobile", "confirmed", true),
    plan("plan-household", "expense", "Water filter cartridge", "2026-07-21", 28_000, "cat-household", "expected", true),
    plan("plan-utilities", "expense", "Electricity estimate", "2026-07-22", 16_000, "cat-utilities", "expected", true),
    plan("plan-subscription", "expense", "Orchid Cloud", "2026-07-23", 3_900, "cat-subscriptions", "expected", false),
    {
      ...plan("plan-salary-july", "income", "Main salary estimate", "2026-07-26", 780_000, undefined, "expected", false),
      windowStartDate: "2026-07-24",
      windowEndDate: "2026-07-26",
      isMainSalaryEstimate: true
    },
    plan("plan-possible-bonus", "income", "Possible campaign bonus", "2026-07-28", 60_000, undefined, "possible", false)
  ];

  const subscriptions: Subscription[] = [
    {
      ...meta("sub-orchid-cloud"),
      recurringRuleId: "rule-orchid-cloud",
      provider: "Orchid Cloud",
      billingFrequency: "monthly",
      nextPaymentDate: "2026-07-23",
      annualRenewalDate: "2026-11-23",
      essential: false,
      notes: "Fictional demo subscription."
    }
  ];
  const extraIncomeAllocations: BluehourSnapshot["extraIncomeAllocations"] = [];

  const recurringRules: RecurringRule[] = [
    {
      ...meta("rule-orchid-cloud"),
      name: "Orchid Cloud",
      kind: "subscription",
      frequency: "monthly",
      interval: 1,
      startDate: "2026-06-23",
      dayOfMonth: 23,
      amountMode: "fixed",
      amountMinor: 3_900,
      fromAccountId: "acc-rainstone-card",
      categoryId: "cat-subscriptions",
      essential: false,
      active: true
    },
    {
      ...meta("rule-main-salary"),
      name: "Main salary estimate",
      kind: "income",
      frequency: "monthly",
      interval: 1,
      startDate: "2026-06-24",
      dayOfMonth: 26,
      windowStartDay: 24,
      windowEndDay: 26,
      amountMode: "fixed",
      amountMinor: 780_000,
      toAccountId: "acc-meranti-current",
      essential: true,
      active: true
    }
  ];

  const categorisationRules: CategorisationRule[] = [
    {
      ...meta("rule-banyan-groceries"),
      name: "Banyan Market groceries",
      priority: 10,
      matchField: "description",
      operator: "contains",
      pattern: "banyan market",
      categoryId: "cat-groceries",
      autoApply: true,
      active: true,
      hitCount: 1,
      lastUsedAt: now
    },
    {
      ...meta("rule-lumen-fuel"),
      name: "Lumen fuel",
      priority: 20,
      matchField: "description",
      operator: "contains",
      pattern: "lumen fuel",
      categoryId: "cat-fuel",
      autoApply: true,
      active: true,
      hitCount: 1,
      lastUsedAt: now
    }
  ];

  const importProfiles: ImportProfile[] = [
    {
      ...meta("profile-meranti-basic"),
      name: "Meranti basic CSV",
      accountId: "acc-meranti-current",
      delimiter: ",",
      encoding: "utf-8",
      dateFormat: "YYYY-MM-DD",
      columnMappingJson: JSON.stringify({
        date: "date",
        description: "description",
        signedAmount: "amount",
        reference: "reference"
      }),
      signRulesJson: JSON.stringify({ expensesAreNegative: true })
    }
  ];

  const importBatches: ImportBatch[] = [];
  const importRowAudits: ImportRowAudit[] = [];

  const reconciliations: Reconciliation[] = [
    {
      ...meta("recon-current-2026-07-12"),
      accountId: "acc-meranti-current",
      asOfDate: "2026-07-12",
      calculatedBalanceMinor: 534_430,
      statedBalanceMinor: 534_430,
      differenceMinor: 0,
      status: "matched",
      note: "Demo reconciliation."
    }
  ];

  const reviewSessions: ReviewSession[] = [
    {
      ...meta("review-week-2026-07-12"),
      type: "weekly",
      periodKey: "2026-W28",
      status: "open",
      itemsJson: JSON.stringify([
        { id: "reconcile", label: "Reconcile enabled accounts", complete: false },
        { id: "uncategorised", label: "Resolve uncategorised transactions", complete: true },
        { id: "next30", label: "Inspect next 30 days", complete: false }
      ])
    }
  ];

  const settings: AppSettings[] = [
    {
      ...meta("settings-preferences"),
      key: "preferences",
      valueJson: JSON.stringify({
        currency: "MYR",
        locale: "en-MY",
        dateDisplay: "DD/MM/YYYY",
        salaryWindowStart: 24,
        salaryWindowEnd: 26,
        minimumProtectedRateBasisPoints: 1000,
        bufferMinimumMinor: 50_000,
        bufferEssentialRateBasisPoints: 1000,
        nearLimitThreshold: 80
      })
    },
    {
      ...meta("settings-google"),
      key: "googleConnection",
      valueJson: JSON.stringify({
        spreadsheetId: "",
        schemaVersion: 1
      })
    }
  ];

  const outboxOperations: OutboxOperation[] = [];
  const conflicts: ConflictRecord[] = [];
  const syncState: SyncState[] = [
    {
      key: "google",
      status: "demo",
      message: "Fictional demo profile. Google is not connected."
    }
  ];

  return {
    accounts,
    balanceSnapshots,
    transactions,
    transactionLegs,
    transactionSplits,
    categories,
    budgetCycles,
    budgetAllocations,
    budgetTransfers,
    recurringRules,
    planInstances,
    subscriptions,
    extraIncomeAllocations,
    categorisationRules,
    importProfiles,
    importBatches,
    importRowAudits,
    reconciliations,
    reviewSessions,
    settings,
    outboxOperations,
    conflicts,
    syncState
  };
}

function category(
  id: string,
  name: string,
  group: Category["group"],
  nature: Category["nature"],
  reservationMode: Category["reservationMode"],
  sortOrder: number
): Category {
  return {
    ...meta(id),
    name,
    group,
    nature,
    reservationMode,
    sortOrder,
    active: true
  };
}

function allocation(id: string, categoryId: string, amountMinor: number): BudgetAllocation {
  return {
    ...meta(id),
    budgetCycleId: "cycle-2026-06-24",
    categoryId,
    baseAmountMinor: amountMinor
  };
}

function transaction(
  id: string,
  type: Transaction["type"],
  occurredOn: Transaction["occurredOn"],
  description: string,
  source: Transaction["source"],
  planInstanceId?: string
): Transaction {
  return {
    ...meta(id),
    type,
    status: "actual",
    occurredOn,
    description,
    merchantNormalized: description.toLowerCase(),
    source,
    planInstanceId
  };
}

function leg(id: string, transactionId: string, accountId: string, deltaMinor: number): TransactionLeg {
  return {
    ...meta(id),
    transactionId,
    accountId,
    deltaMinor
  };
}

function split(
  id: string,
  transactionId: string,
  categoryId: string,
  direction: TransactionSplit["direction"],
  amountMinor: number
): TransactionSplit {
  return {
    ...meta(id),
    transactionId,
    categoryId,
    direction,
    amountMinor
  };
}

function plan(
  id: string,
  kind: PlanInstance["kind"],
  name: string,
  expectedDate: PlanInstance["expectedDate"],
  expectedAmountMinor: number,
  categoryId: string | undefined,
  confidence: PlanInstance["confidence"],
  essential: boolean
): PlanInstance {
  return {
    ...meta(id),
    kind,
    name,
    expectedDate,
    expectedAmountMinor,
    confidence,
    reservation: "reserved",
    status: "scheduled",
    categoryId,
    essential
  };
}
