import { scoreDuplicateMatch, type DuplicateMatchResult } from "./duplicateMatching";
import type { BluehourSnapshot, IsoDate, Transaction, TransactionLeg } from "../types";
import { isActive } from "../types";

export interface ImportedLedgerRow {
  sourceReference?: string;
  accountId: string;
  signedAmountMinor: number;
  occurredOn: IsoDate;
  description: string;
  importFingerprint?: string;
}

export interface RankedDuplicateCandidate extends DuplicateMatchResult {
  transactionId: string;
}

export function rankDuplicateCandidates(row: ImportedLedgerRow, snapshot: BluehourSnapshot): RankedDuplicateCandidate[] {
  const activeLegs = snapshot.transactionLegs.filter(isActive);
  return snapshot.transactions
    .filter(isActive)
    .flatMap((transaction) => {
      const importedAccountLeg = activeLegForAccount(transaction, activeLegs, row.accountId);
      if (!importedAccountLeg) {
        return [];
      }

      const match = scoreDuplicateMatch(
        {
          sourceReference: row.sourceReference,
          accountId: row.accountId,
          amountMinor: row.signedAmountMinor,
          occurredOn: row.occurredOn,
          description: row.description,
          importFingerprint: row.importFingerprint
        },
        {
          sourceReference: transaction.importFingerprint,
          accountId: importedAccountLeg.accountId,
          amountMinor: importedAccountLeg.deltaMinor,
          occurredOn: transaction.occurredOn,
          description: transaction.description,
          importFingerprint: transaction.importFingerprint
        }
      );

      return [{ ...match, transactionId: transaction.id }];
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.transactionId.localeCompare(right.transactionId));
}

function activeLegForAccount(
  transaction: Transaction,
  legs: readonly TransactionLeg[],
  accountId: string
): TransactionLeg | undefined {
  return legs.find((leg) => leg.transactionId === transaction.id && leg.accountId === accountId);
}
