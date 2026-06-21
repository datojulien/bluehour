import { normaliseDescription } from "../imports/duplicateMatching";
import { touchRecord } from "../records";
import type { CategorisationRule, Transaction } from "../types";
import { isActive } from "../types";

export interface RuleMatchInput {
  description: string;
  merchantNormalized?: string;
  accountId?: string;
  amountMinor: number;
}

export interface RuleMatchResult {
  rule: CategorisationRule;
  updatedRule: CategorisationRule;
}

export function applyCategorisationRules(
  input: RuleMatchInput,
  rules: readonly CategorisationRule[]
): RuleMatchResult | null {
  const sortedRules = rules.filter((rule) => isActive(rule) && rule.active && rule.autoApply).sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    if (matchesRule(input, rule)) {
      return {
        rule,
        updatedRule: {
          ...touchRecord(rule),
          hitCount: rule.hitCount + 1,
          lastUsedAt: new Date().toISOString()
        }
      };
    }
  }

  return null;
}

export function findRuleProposals(transactions: readonly Transaction[], minimumHits = 3): Array<{ merchant: string; count: number }> {
  const counts = new Map<string, number>();
  transactions
    .filter((transaction) => isActive(transaction) && transaction.type === "expense")
    .forEach((transaction) => {
      const merchant = transaction.merchantNormalized || normaliseDescription(transaction.description);
      if (merchant) {
        counts.set(merchant, (counts.get(merchant) ?? 0) + 1);
      }
    });

  return [...counts.entries()]
    .filter(([, count]) => count >= minimumHits)
    .map(([merchant, count]) => ({ merchant, count }));
}

export function matchesRule(input: RuleMatchInput, rule: CategorisationRule): boolean {
  if (rule.accountId && rule.accountId !== input.accountId) {
    return false;
  }

  const value = valueForRule(input, rule);
  const pattern = rule.pattern.trim();

  switch (rule.operator) {
    case "exact":
      return value === pattern.toLowerCase();
    case "contains":
      return value.includes(pattern.toLowerCase());
    case "starts_with":
      return value.startsWith(pattern.toLowerCase());
    case "regex":
      try {
        return new RegExp(pattern, "i").test(value);
      } catch {
        return false;
      }
    case "amount_range": {
      const [from, to] = pattern.split(":").map((part) => Number.parseInt(part, 10));
      return Number.isInteger(from) && Number.isInteger(to) && input.amountMinor >= from && input.amountMinor <= to;
    }
  }
}

function valueForRule(input: RuleMatchInput, rule: CategorisationRule): string {
  switch (rule.matchField) {
    case "description":
      return normaliseDescription(input.description);
    case "merchantNormalized":
      return normaliseDescription(input.merchantNormalized ?? input.description);
    case "accountId":
      return input.accountId ?? "";
    case "amountMinor":
      return String(input.amountMinor);
  }
}
