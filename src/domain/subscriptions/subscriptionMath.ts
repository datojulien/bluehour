import type { RecurringRule, Subscription } from "../types";

export interface MonthlyEquivalentResult {
  monthlyMinor: number;
  annualMinor: number;
  estimated: boolean;
  explanation: string;
}

export function monthlyEquivalentMinor(amountMinor: number, frequency: Subscription["billingFrequency"]): MonthlyEquivalentResult {
  switch (frequency) {
    case "monthly":
      return {
        monthlyMinor: amountMinor,
        annualMinor: amountMinor * 12,
        estimated: false,
        explanation: "Monthly billing uses the actual billing amount."
      };
    case "quarterly":
      return {
        monthlyMinor: divideHalfUp(amountMinor, 3),
        annualMinor: amountMinor * 4,
        estimated: false,
        explanation: "Quarterly billing is divided by 3 with half-up integer-sen rounding."
      };
    case "yearly":
      return {
        monthlyMinor: divideHalfUp(amountMinor, 12),
        annualMinor: amountMinor,
        estimated: false,
        explanation: "Yearly billing is divided by 12 with half-up integer-sen rounding."
      };
    case "weekly":
      return {
        monthlyMinor: divideHalfUp(amountMinor * 52, 12),
        annualMinor: amountMinor * 52,
        estimated: true,
        explanation: "Weekly billing is estimated as amount × 52 ÷ 12 with half-up integer-sen rounding."
      };
    case "custom":
      return {
        monthlyMinor: amountMinor,
        annualMinor: amountMinor * 12,
        estimated: true,
        explanation: "Custom billing uses the entered amount as a monthly estimate until a precise cadence is recorded."
      };
  }
}

export function subscriptionDisplayAmount(subscription: Subscription, rule: RecurringRule | undefined): number {
  void subscription;
  return rule?.amountMinor ?? 0;
}

function divideHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    throw new Error("Denominator must be positive.");
  }
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}
