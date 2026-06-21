export type MinorUnit = number;

const MYR_FORMATTER = new Intl.NumberFormat("en-MY", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function assertIntegerMinor(value: number, label = "amount"): asserts value is MinorUnit {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be stored as an integer number of sen`);
  }
}

export function parseMoneyInput(input: string): MinorUnit {
  const trimmed = input
    .trim()
    .replace(/,/g, "")
    .replace(/^(-?)\s*RM\s?/i, "$1");
  if (!/^-?\d+(\.\d{0,2})?$/.test(trimmed)) {
    throw new Error("Enter a MYR amount with at most two decimal places");
  }

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [ringgit = "0", sen = ""] = unsigned.split(".");
  const paddedSen = sen.padEnd(2, "0");
  const amount = Number.parseInt(ringgit, 10) * 100 + Number.parseInt(paddedSen || "0", 10);

  return negative ? -amount : amount;
}

export function formatMYR(amountMinor: MinorUnit, privacy = false): string {
  assertIntegerMinor(amountMinor);
  if (privacy) {
    return "RM••••••";
  }

  const sign = amountMinor < 0 ? "-" : "";
  const absolute = Math.abs(amountMinor);
  return `${sign}RM${MYR_FORMATTER.format(absolute / 100)}`;
}

export function percentageOfMinor(amountMinor: MinorUnit, basisPoints: number): MinorUnit {
  assertIntegerMinor(amountMinor);
  assertIntegerMinor(basisPoints, "basis points");

  const sign = amountMinor < 0 ? -1 : 1;
  const absoluteNumerator = Math.abs(amountMinor) * basisPoints;
  return sign * Math.floor((absoluteNumerator + 5_000) / 10_000);
}

export function sumMinor(values: readonly MinorUnit[]): MinorUnit {
  return values.reduce((total, value) => {
    assertIntegerMinor(value);
    return total + value;
  }, 0);
}

export function maxMinor(...values: readonly MinorUnit[]): MinorUnit {
  values.forEach((value) => assertIntegerMinor(value));
  return Math.max(...values);
}

export function clampNonNegative(amountMinor: MinorUnit): MinorUnit {
  assertIntegerMinor(amountMinor);
  return Math.max(0, amountMinor);
}
