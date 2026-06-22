import { normaliseDescription } from "./duplicateMatching";
import { createRecordMeta, touchRecord } from "../records";
import type { ImportAuditOutcome, ImportDecisionSource, ImportRowAudit, IsoDate, Transaction } from "../types";

export interface NormalisedImportRow {
  importBatchId: string;
  rowIndex: number;
  fileHash: string;
  occurredOn: IsoDate;
  description: string;
  signedAmountMinor: number;
  accountId: string;
  sourceReference?: string;
  rowFingerprint: string;
}

export interface ImportAuditCandidate {
  transactionId: string;
  score: number;
  reasons: string[];
}

export function fingerprintImportRow(input: {
  fileHash: string;
  rowIndex: number;
  occurredOn: IsoDate;
  description: string;
  signedAmountMinor: number;
  sourceReference?: string;
}): string {
  return [
    input.fileHash,
    input.rowIndex,
    input.occurredOn,
    normaliseDescription(input.description),
    input.signedAmountMinor,
    input.sourceReference ?? ""
  ].join("|");
}

export function createImportRowAudit(input: {
  row: NormalisedImportRow;
  outcome: ImportAuditOutcome;
  candidates?: readonly ImportAuditCandidate[];
  linkedTransactionId?: string;
  decisionSource: ImportDecisionSource;
  failedReason?: string;
}): ImportRowAudit {
  const bestCandidate = input.candidates?.[0];
  return {
    ...createRecordMeta("audit"),
    importBatchId: input.row.importBatchId,
    rowIndex: input.row.rowIndex,
    fileHash: input.row.fileHash,
    occurredOn: input.row.occurredOn,
    description: input.row.description,
    signedAmountMinor: input.row.signedAmountMinor,
    accountId: input.row.accountId,
    sourceReference: input.row.sourceReference,
    rowFingerprint: input.row.rowFingerprint,
    outcome: input.outcome,
    linkedTransactionId: input.linkedTransactionId,
    matchScore: bestCandidate?.score,
    matchReasonsJson: JSON.stringify(bestCandidate?.reasons ?? []),
    candidateTransactionIdsJson: JSON.stringify(input.candidates?.map((candidate) => candidate.transactionId) ?? []),
    candidateScoresJson: JSON.stringify(input.candidates ?? []),
    decisionSource: input.decisionSource,
    decidedAt: input.decisionSource === "none" ? undefined : new Date().toISOString(),
    failedReason: input.failedReason
  };
}

export function decideImportAudit(
  audit: ImportRowAudit,
  outcome: Extract<ImportAuditOutcome, "created" | "user_linked" | "ignored">,
  linkedTransactionId?: string
): ImportRowAudit {
  return {
    ...touchRecord(audit),
    outcome,
    linkedTransactionId,
    decisionSource: "user_approved",
    decidedAt: new Date().toISOString()
  };
}

export function markImportAuditRolledBack(audit: ImportRowAudit, note: string): ImportRowAudit {
  return {
    ...touchRecord(audit),
    rolledBackAt: new Date().toISOString(),
    rollbackNote: note
  };
}

export function parseAuditCandidateIds(audit: ImportRowAudit): string[] {
  return parseJsonArray(audit.candidateTransactionIdsJson).filter((value): value is string => typeof value === "string");
}

export function parseAuditCandidates(audit: ImportRowAudit): ImportAuditCandidate[] {
  return parseJsonArray(audit.candidateScoresJson).filter(isAuditCandidate);
}

export function transactionDraftFromAudit(audit: ImportRowAudit): Pick<Transaction, "type" | "occurredOn" | "description"> & {
  amountMinor: number;
  accountId: string;
  importBatchId: string;
  importFingerprint: string;
} {
  return {
    type: audit.signedAmountMinor >= 0 ? "income" : "expense",
    occurredOn: audit.occurredOn,
    description: audit.description,
    amountMinor: Math.abs(audit.signedAmountMinor),
    accountId: audit.accountId,
    importBatchId: audit.importBatchId,
    importFingerprint: audit.rowFingerprint
  };
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isAuditCandidate(value: unknown): value is ImportAuditCandidate {
  const candidate = value as ImportAuditCandidate;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.transactionId === "string" &&
    typeof candidate.score === "number" &&
    Array.isArray(candidate.reasons)
  );
}
