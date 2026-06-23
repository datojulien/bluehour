import type { Subscription } from "../types";

export interface SubscriptionCostSummary {
  monthlyMinor: number;
  annualMinor: number;
  estimated: boolean;
}

export function subscriptionCostSummary(amountMinor: number, frequency: Subscription["billingFrequency"]): SubscriptionCostSummary {
  if (amountMinor < 0 || !Number.isInteger(amountMinor)) {
    throw new Error("Subscription amount must be an integer sen value.");
  }

  switch (frequency) {
    case "monthly":
      return { monthlyMinor: amountMinor, annualMinor: amountMinor * 12, estimated: false };
    case "quarterly":
      return { monthlyMinor: roundDivide(amountMinor, 3), annualMinor: amountMinor * 4, estimated: false };
    case "yearly":
      return { monthlyMinor: roundDivide(amountMinor, 12), annualMinor: amountMinor, estimated: false };
    case "weekly":
      return { monthlyMinor: roundDivide(amountMinor * 52, 12), annualMinor: amountMinor * 52, estimated: true };
    case "custom":
      return { monthlyMinor: amountMinor, annualMinor: amountMinor * 12, estimated: true };
  }
}

function roundDivide(numerator: number, denominator: number): number {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}
