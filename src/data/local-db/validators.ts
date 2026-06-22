import { z } from "zod";

const metaSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  archivedAt: z.string().nullable().optional(),
  revision: z.number().int().nonnegative()
});

const minor = z.number().int();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const jsonArrayString = z.string().refine((value) => {
  try {
    return Array.isArray(JSON.parse(value));
  } catch {
    return false;
  }
}, "Expected a JSON array string");

export const accountSchema = metaSchema.extend({
  name: z.string(),
  type: z.enum(["bank", "savings", "cash", "ewallet", "credit_card", "loan", "investment", "property", "vehicle", "other"]),
  role: z.enum(["spendable", "protected", "investment", "asset", "liability"]),
  trackingMode: z.enum(["ledger", "manual_snapshot", "hybrid"]),
  currency: z.literal("MYR"),
  institutionLabel: z.string().optional(),
  reconcileWeekly: z.boolean(),
  sortOrder: z.number().int()
});

export const balanceSnapshotSchema = metaSchema.extend({
  accountId: z.string(),
  asOfDate: isoDate,
  amountMinor: minor,
  source: z.enum(["opening", "reconciliation", "manual_valuation", "import"]),
  note: z.string().optional()
});

export const transactionSchema = metaSchema.extend({
  type: z.enum(["expense", "income", "transfer", "refund", "reimbursement", "reconciliation_adjustment", "opening_adjustment"]),
  status: z.literal("actual"),
  occurredOn: isoDate,
  description: z.string(),
  merchantNormalized: z.string().optional(),
  note: z.string().optional(),
  source: z.enum(["manual", "csv_import", "recurring_confirmation", "reconciliation"]),
  planInstanceId: z.string().optional(),
  refundOfTransactionId: z.string().optional(),
  importBatchId: z.string().optional(),
  importFingerprint: z.string().optional()
});

export const transactionLegSchema = metaSchema.extend({
  transactionId: z.string(),
  accountId: z.string(),
  deltaMinor: minor
});

export const transactionSplitSchema = metaSchema.extend({
  transactionId: z.string(),
  categoryId: z.string(),
  direction: z.enum(["expense", "income", "reversal"]),
  amountMinor: minor.nonnegative()
});

export const categorySchema = metaSchema.extend({
  name: z.string(),
  group: z.enum(["committed", "essential_flexible", "discretionary", "protected", "administrative"]),
  nature: z.enum(["essential", "discretionary", "protected", "administrative"]),
  reservationMode: z.enum(["plan", "envelope", "protected", "none"]),
  iconKey: z.string().optional(),
  sortOrder: z.number().int(),
  active: z.boolean()
});

export const budgetCycleSchema = metaSchema.extend({
  startedOn: isoDate,
  endedOn: isoDate.optional(),
  status: z.enum(["setup", "open", "closing", "closed"]),
  salaryTransactionId: z.string(),
  expectedNextSalaryFrom: isoDate,
  expectedNextSalaryTo: isoDate,
  protectedRateBasisPoints: z.number().int(),
  bufferMinimumMinor: minor.nonnegative(),
  bufferEssentialRateBasisPoints: z.number().int(),
  actualMainSalaryMinor: minor.nonnegative(),
  additionalProtectedCommitmentMinor: minor.nonnegative().optional(),
  closedAt: z.string().optional()
});

export const budgetAllocationSchema = metaSchema.extend({
  budgetCycleId: z.string(),
  categoryId: z.string(),
  baseAmountMinor: minor.nonnegative(),
  note: z.string().optional()
});

export const budgetTransferSchema = metaSchema.extend({
  budgetCycleId: z.string(),
  fromCategoryId: z.string(),
  toCategoryId: z.string(),
  amountMinor: minor.nonnegative(),
  occurredOn: isoDate,
  note: z.string().optional()
});

export const planInstanceSchema = metaSchema.extend({
  recurringRuleId: z.string().optional(),
  kind: z.enum(["income", "expense", "transfer"]),
  name: z.string(),
  expectedDate: isoDate,
  windowStartDate: isoDate.optional(),
  windowEndDate: isoDate.optional(),
  expectedAmountMinor: minor.nonnegative(),
  confidence: z.enum(["expected", "confirmed", "possible"]),
  reservation: z.enum(["reserved", "informational"]),
  status: z.enum(["scheduled", "fulfilled", "skipped", "archived"]),
  linkedTransactionId: z.string().optional(),
  categoryId: z.string().optional(),
  accountId: z.string().optional(),
  fromAccountId: z.string().optional(),
  toAccountId: z.string().optional(),
  essential: z.boolean().optional(),
  isMainSalaryEstimate: z.boolean().optional()
});

export const subscriptionSchema = metaSchema.extend({
  recurringRuleId: z.string(),
  provider: z.string(),
  billingFrequency: z.enum(["weekly", "monthly", "quarterly", "yearly", "custom"]),
  nextPaymentDate: isoDate,
  annualRenewalDate: isoDate.optional(),
  cancellationDeadline: isoDate.optional(),
  essential: z.boolean(),
  notes: z.string().optional(),
  priceHistoryJson: z.string().optional()
});

export const categorisationRuleSchema = metaSchema.extend({
  name: z.string(),
  priority: z.number().int(),
  matchField: z.enum(["description", "merchantNormalized", "accountId", "amountMinor"]),
  operator: z.enum(["exact", "contains", "starts_with", "regex", "amount_range"]),
  pattern: z.string(),
  accountId: z.string().optional(),
  categoryId: z.string(),
  autoApply: z.boolean(),
  active: z.boolean(),
  hitCount: z.number().int().nonnegative(),
  lastUsedAt: z.string().optional()
});

export const importProfileSchema = metaSchema.extend({
  name: z.string(),
  accountId: z.string(),
  delimiter: z.enum([",", ";", "\t"]),
  encoding: z.literal("utf-8"),
  dateFormat: z.enum(["YYYY-MM-DD", "DD/MM/YYYY"]),
  columnMappingJson: z.string(),
  signRulesJson: z.string()
});

export const importBatchSchema = metaSchema.extend({
  importProfileId: z.string(),
  fileName: z.string(),
  fileHash: z.string(),
  importedAt: z.string(),
  rowCount: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  matchedCount: z.number().int().nonnegative(),
  reviewCount: z.number().int().nonnegative()
});

export const importRowAuditSchema = metaSchema.extend({
  importBatchId: z.string(),
  rowIndex: z.number().int().nonnegative(),
  fileHash: z.string(),
  occurredOn: isoDate,
  description: z.string(),
  signedAmountMinor: minor,
  accountId: z.string(),
  sourceReference: z.string().optional(),
  rowFingerprint: z.string(),
  outcome: z.enum(["created", "strong_linked", "uncertain", "user_linked", "ignored", "failed"]),
  linkedTransactionId: z.string().optional(),
  matchScore: z.number().int().optional(),
  matchReasonsJson: jsonArrayString,
  candidateTransactionIdsJson: jsonArrayString,
  candidateScoresJson: jsonArrayString,
  decisionSource: z.enum(["automatic", "user_approved", "none"]),
  decidedAt: z.string().optional(),
  failedReason: z.string().optional(),
  rolledBackAt: z.string().optional(),
  rollbackNote: z.string().optional()
});

export const reconciliationSchema = metaSchema.extend({
  accountId: z.string(),
  asOfDate: isoDate,
  calculatedBalanceMinor: minor,
  statedBalanceMinor: minor,
  differenceMinor: minor,
  status: z.enum(["matched", "resolved", "adjusted", "skipped"]),
  adjustmentTransactionId: z.string().optional(),
  note: z.string().optional()
});

export const reviewSessionSchema = metaSchema.extend({
  type: z.enum(["daily", "weekly", "cycle_close"]),
  periodKey: z.string(),
  status: z.enum(["open", "completed", "skipped"]),
  itemsJson: z.string(),
  completedAt: z.string().optional()
});

export const recurringRuleSchema = metaSchema.extend({
  name: z.string(),
  kind: z.enum(["income", "expense", "transfer", "subscription"]),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly", "custom"]),
  interval: z.number().int().positive(),
  startDate: isoDate,
  endDate: isoDate.optional(),
  dayOfMonth: z.number().int().optional(),
  windowStartDay: z.number().int().optional(),
  windowEndDay: z.number().int().optional(),
  amountMode: z.enum(["fixed", "estimated"]),
  amountMinor: minor.nonnegative(),
  fromAccountId: z.string().optional(),
  toAccountId: z.string().optional(),
  categoryId: z.string().optional(),
  essential: z.boolean(),
  active: z.boolean()
});

export const appSettingsSchema = metaSchema.extend({
  key: z.enum(["preferences", "googleConnection", "backupStatus", "onboardingBudgetTemplate"]),
  valueJson: z.string()
});

export const outboxOperationSchema = z.object({
  id: z.string(),
  tableName: z.string(),
  recordId: z.string(),
  operation: z.enum(["put", "archive"]),
  payloadJson: z.string(),
  createdAt: z.string(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().optional()
});

export const conflictRecordSchema = metaSchema.extend({
  tableName: z.string(),
  recordId: z.string(),
  localJson: z.string(),
  remoteJson: z.string(),
  status: z.enum(["open", "resolved"])
});

export const syncStateSchema = z.object({
  key: z.literal("google"),
  status: z.enum([
    "demo",
    "saved_locally",
    "waiting_to_sync",
    "syncing",
    "synced",
    "needs_reconnection",
    "conflict",
    "failed",
    "read_only_recovery"
  ]),
  spreadsheetId: z.string().optional(),
  remoteRevision: z.number().int().optional(),
  lastSyncedAt: z.string().optional(),
  message: z.string().optional()
});

export const syncedStoreSchemas = {
  accounts: accountSchema,
  balanceSnapshots: balanceSnapshotSchema,
  transactions: transactionSchema,
  transactionLegs: transactionLegSchema,
  transactionSplits: transactionSplitSchema,
  categories: categorySchema,
  budgetCycles: budgetCycleSchema,
  budgetAllocations: budgetAllocationSchema,
  budgetTransfers: budgetTransferSchema,
  recurringRules: recurringRuleSchema,
  planInstances: planInstanceSchema,
  subscriptions: subscriptionSchema,
  categorisationRules: categorisationRuleSchema,
  importProfiles: importProfileSchema,
  importBatches: importBatchSchema,
  importRowAudits: importRowAuditSchema,
  reconciliations: reconciliationSchema,
  reviewSessions: reviewSessionSchema,
  settings: appSettingsSchema
} as const;
