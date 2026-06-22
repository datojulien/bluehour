export type CurrencyCode = "MYR";
export type IsoDate = `${number}-${number}-${number}`;
export type UtcIsoTimestamp = string;

export interface RecordMeta {
  id: string;
  createdAt: UtcIsoTimestamp;
  updatedAt: UtcIsoTimestamp;
  archivedAt?: UtcIsoTimestamp | null;
  revision: number;
  lastModifiedByClientId?: string;
}

export type AccountType =
  | "bank"
  | "savings"
  | "cash"
  | "ewallet"
  | "credit_card"
  | "loan"
  | "investment"
  | "property"
  | "vehicle"
  | "other";

export type AccountRole = "spendable" | "protected" | "investment" | "asset" | "liability";
export type TrackingMode = "ledger" | "manual_snapshot" | "hybrid";

export interface Account extends RecordMeta {
  name: string;
  type: AccountType;
  role: AccountRole;
  trackingMode: TrackingMode;
  currency: CurrencyCode;
  institutionLabel?: string;
  reconcileWeekly: boolean;
  sortOrder: number;
}

export type BalanceSnapshotSource = "opening" | "reconciliation" | "manual_valuation" | "import";

export interface BalanceSnapshot extends RecordMeta {
  accountId: string;
  asOfDate: IsoDate;
  amountMinor: number;
  source: BalanceSnapshotSource;
  note?: string;
}

export type TransactionType =
  | "expense"
  | "income"
  | "transfer"
  | "refund"
  | "reimbursement"
  | "reconciliation_adjustment"
  | "opening_adjustment";

export interface Transaction extends RecordMeta {
  type: TransactionType;
  status: "actual";
  occurredOn: IsoDate;
  description: string;
  merchantNormalized?: string;
  note?: string;
  source: "manual" | "csv_import" | "recurring_confirmation" | "reconciliation";
  planInstanceId?: string;
  refundOfTransactionId?: string;
  importBatchId?: string;
  importFingerprint?: string;
}

export interface TransactionLeg extends RecordMeta {
  transactionId: string;
  accountId: string;
  deltaMinor: number;
}

export type SplitDirection = "expense" | "income" | "reversal";

export interface TransactionSplit extends RecordMeta {
  transactionId: string;
  categoryId: string;
  direction: SplitDirection;
  amountMinor: number;
}

export type CategoryGroup =
  | "committed"
  | "essential_flexible"
  | "discretionary"
  | "protected"
  | "administrative";

export type CategoryNature = "essential" | "discretionary" | "protected" | "administrative";
export type ReservationMode = "plan" | "envelope" | "protected" | "none";

export interface Category extends RecordMeta {
  name: string;
  group: CategoryGroup;
  nature: CategoryNature;
  reservationMode: ReservationMode;
  iconKey?: string;
  sortOrder: number;
  active: boolean;
}

export interface BudgetCycle extends RecordMeta {
  startedOn: IsoDate;
  endedOn?: IsoDate;
  status: "setup" | "open" | "closing" | "closed";
  salaryTransactionId: string;
  expectedNextSalaryFrom: IsoDate;
  expectedNextSalaryTo: IsoDate;
  protectedRateBasisPoints: number;
  bufferMinimumMinor: number;
  bufferEssentialRateBasisPoints: number;
  actualMainSalaryMinor: number;
  additionalProtectedCommitmentMinor?: number;
  closedAt?: UtcIsoTimestamp;
}

export interface BudgetAllocation extends RecordMeta {
  budgetCycleId: string;
  categoryId: string;
  baseAmountMinor: number;
  note?: string;
}

export interface BudgetTransfer extends RecordMeta {
  budgetCycleId: string;
  fromCategoryId: string;
  toCategoryId: string;
  amountMinor: number;
  occurredOn: IsoDate;
  note?: string;
}

export type PlanKind = "income" | "expense" | "transfer";
export type PlanConfidence = "expected" | "confirmed" | "possible";
export type PlanStatus = "scheduled" | "fulfilled" | "skipped" | "archived";

export interface PlanInstance extends RecordMeta {
  recurringRuleId?: string;
  kind: PlanKind;
  name: string;
  expectedDate: IsoDate;
  windowStartDate?: IsoDate;
  windowEndDate?: IsoDate;
  expectedAmountMinor: number;
  confidence: PlanConfidence;
  reservation: "reserved" | "informational";
  status: PlanStatus;
  linkedTransactionId?: string;
  categoryId?: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  essential?: boolean;
  isMainSalaryEstimate?: boolean;
}

export interface Subscription extends RecordMeta {
  recurringRuleId: string;
  provider: string;
  billingFrequency: "weekly" | "monthly" | "quarterly" | "yearly" | "custom";
  nextPaymentDate: IsoDate;
  annualRenewalDate?: IsoDate;
  cancellationDeadline?: IsoDate;
  essential: boolean;
  notes?: string;
  priceHistoryJson?: string;
}

export interface CategorisationRule extends RecordMeta {
  name: string;
  priority: number;
  matchField: "description" | "merchantNormalized" | "accountId" | "amountMinor";
  operator: "exact" | "contains" | "starts_with" | "regex" | "amount_range";
  pattern: string;
  accountId?: string;
  categoryId: string;
  autoApply: boolean;
  active: boolean;
  hitCount: number;
  lastUsedAt?: UtcIsoTimestamp;
}

export interface ImportProfile extends RecordMeta {
  name: string;
  accountId: string;
  delimiter: "," | ";" | "\t";
  encoding: "utf-8";
  dateFormat: "YYYY-MM-DD" | "DD/MM/YYYY";
  columnMappingJson: string;
  signRulesJson: string;
}

export interface ImportBatch extends RecordMeta {
  importProfileId: string;
  fileName: string;
  fileHash: string;
  importedAt: UtcIsoTimestamp;
  rowCount: number;
  newCount: number;
  matchedCount: number;
  reviewCount: number;
}

export type ImportAuditOutcome = "created" | "strong_linked" | "uncertain" | "user_linked" | "ignored" | "failed";
export type ImportDecisionSource = "automatic" | "user_approved" | "none";

export interface ImportRowAudit extends RecordMeta {
  importBatchId: string;
  rowIndex: number;
  fileHash: string;
  occurredOn: IsoDate;
  description: string;
  signedAmountMinor: number;
  accountId: string;
  sourceReference?: string;
  rowFingerprint: string;
  outcome: ImportAuditOutcome;
  linkedTransactionId?: string;
  matchScore?: number;
  matchReasonsJson: string;
  candidateTransactionIdsJson: string;
  candidateScoresJson: string;
  decisionSource: ImportDecisionSource;
  decidedAt?: UtcIsoTimestamp;
  failedReason?: string;
  rolledBackAt?: UtcIsoTimestamp;
  rollbackNote?: string;
}

export interface Reconciliation extends RecordMeta {
  accountId: string;
  asOfDate: IsoDate;
  calculatedBalanceMinor: number;
  statedBalanceMinor: number;
  differenceMinor: number;
  status: "matched" | "resolved" | "adjusted" | "skipped";
  adjustmentTransactionId?: string;
  note?: string;
}

export interface ReviewSession extends RecordMeta {
  type: "daily" | "weekly" | "cycle_close";
  periodKey: string;
  status: "open" | "completed" | "skipped";
  itemsJson: string;
  completedAt?: UtcIsoTimestamp;
}

export interface RecurringRule extends RecordMeta {
  name: string;
  kind: "income" | "expense" | "transfer" | "subscription";
  frequency: "weekly" | "monthly" | "quarterly" | "yearly" | "custom";
  interval: number;
  startDate: IsoDate;
  endDate?: IsoDate;
  dayOfMonth?: number;
  windowStartDay?: number;
  windowEndDay?: number;
  amountMode: "fixed" | "estimated";
  amountMinor: number;
  fromAccountId?: string;
  toAccountId?: string;
  categoryId?: string;
  essential: boolean;
  active: boolean;
}

export interface AppSettings extends RecordMeta {
  key: "preferences" | "googleConnection" | "backupStatus" | "onboardingBudgetTemplate" | "profileManifest";
  valueJson: string;
}

export interface OutboxOperation {
  id: string;
  tableName: string;
  recordId: string;
  operation: "put" | "archive";
  payloadJson: string;
  createdAt: UtcIsoTimestamp;
  attempts: number;
  lastError?: string;
}

export interface ConflictRecord extends RecordMeta {
  tableName: string;
  recordId: string;
  localJson: string;
  remoteJson: string;
  status: "open" | "resolved";
}

export interface SyncState {
  key: "google";
  status:
    | "demo"
    | "saved_locally"
    | "waiting_to_sync"
    | "syncing"
    | "synced"
    | "needs_reconnection"
    | "conflict"
    | "failed"
    | "read_only_recovery";
  spreadsheetId?: string;
  profileId?: string;
  remoteRevision?: number;
  lastSyncedAt?: UtcIsoTimestamp;
  lastRemoteWriterDeviceId?: string;
  message?: string;
}

export interface BluehourSnapshot {
  accounts: Account[];
  balanceSnapshots: BalanceSnapshot[];
  transactions: Transaction[];
  transactionLegs: TransactionLeg[];
  transactionSplits: TransactionSplit[];
  categories: Category[];
  budgetCycles: BudgetCycle[];
  budgetAllocations: BudgetAllocation[];
  budgetTransfers: BudgetTransfer[];
  recurringRules: RecurringRule[];
  planInstances: PlanInstance[];
  subscriptions: Subscription[];
  categorisationRules: CategorisationRule[];
  importProfiles: ImportProfile[];
  importBatches: ImportBatch[];
  importRowAudits: ImportRowAudit[];
  reconciliations: Reconciliation[];
  reviewSessions: ReviewSession[];
  settings: AppSettings[];
  outboxOperations: OutboxOperation[];
  conflicts: ConflictRecord[];
  syncState: SyncState[];
}

export const isActive = <T extends { archivedAt?: string | null }>(record: T): boolean => !record.archivedAt;
