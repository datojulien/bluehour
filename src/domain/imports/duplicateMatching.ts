import { addDays, isWithinInclusive } from "../dates";
import type { IsoDate } from "../types";

export interface MatchCandidate {
  sourceReference?: string;
  accountId: string;
  amountMinor: number;
  occurredOn: IsoDate;
  description: string;
  importFingerprint?: string;
}

export interface DuplicateMatchResult {
  outcome: "strong" | "uncertain" | "new";
  score: number;
  reasons: string[];
}

export function scoreDuplicateMatch(candidate: MatchCandidate, existing: MatchCandidate): DuplicateMatchResult {
  const reasons: string[] = [];
  let score = 0;

  if (candidate.importFingerprint && candidate.importFingerprint === existing.importFingerprint) {
    return { outcome: "strong", score: 100, reasons: ["same import fingerprint"] };
  }

  if (candidate.sourceReference && candidate.sourceReference === existing.sourceReference) {
    score += 45;
    reasons.push("same source reference");
  }

  if (candidate.accountId === existing.accountId) {
    score += 20;
    reasons.push("same account");
  }

  if (candidate.amountMinor === existing.amountMinor) {
    score += 20;
    reasons.push("same amount");
  }

  if (isWithinInclusive(candidate.occurredOn, addDays(existing.occurredOn, -1), addDays(existing.occurredOn, 1))) {
    score += 10;
    reasons.push("same or adjacent date");
  }

  const similarity = descriptionSimilarity(candidate.description, existing.description);
  if (similarity >= 0.7) {
    score += 10;
    reasons.push("similar description");
  } else if (similarity >= 0.4) {
    score += 5;
    reasons.push("partially similar description");
  }

  if (score >= 75) {
    return { outcome: "strong", score, reasons };
  }

  if (score >= 50) {
    return { outcome: "uncertain", score, reasons };
  }

  return { outcome: "new", score, reasons };
}

export function normaliseDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function descriptionSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normaliseDescription(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normaliseDescription(right).split(" ").filter(Boolean));

  if (leftTokens.size === 0 && rightTokens.size === 0) {
    return 1;
  }

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}
