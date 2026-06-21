import type { IsoDate } from "./types";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function assertIsoDate(value: string): asserts value is IsoDate {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new Error(`Expected ISO local date, received ${value}`);
  }
}

export function compareIsoDate(left: IsoDate, right: IsoDate): number {
  return left.localeCompare(right);
}

export function isOnOrAfter(date: IsoDate, start: IsoDate): boolean {
  return compareIsoDate(date, start) >= 0;
}

export function isOnOrBefore(date: IsoDate, end: IsoDate): boolean {
  return compareIsoDate(date, end) <= 0;
}

export function isWithinInclusive(date: IsoDate, start: IsoDate, end: IsoDate): boolean {
  return isOnOrAfter(date, start) && isOnOrBefore(date, end);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const utc = toUtcDate(date);
  utc.setUTCDate(utc.getUTCDate() + days);
  return fromUtcDate(utc);
}

export function daysBetweenInclusive(start: IsoDate, end: IsoDate): number {
  const difference = Math.floor((toUtcDate(end).getTime() - toUtcDate(start).getTime()) / DAY_MS);
  return Math.max(1, difference + 1);
}

export function formatDisplayDate(date: IsoDate): string {
  assertIsoDate(date);
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export function endOfMonth(date: IsoDate): IsoDate {
  const current = toUtcDate(date);
  const last = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0));
  return fromUtcDate(last);
}

export function addMonthsClamped(date: IsoDate, months: number, preferredDay?: number): IsoDate {
  const current = toUtcDate(date);
  const targetYear = current.getUTCFullYear();
  const targetMonth = current.getUTCMonth() + months;
  const desiredDay = preferredDay ?? current.getUTCDate();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return fromUtcDate(new Date(Date.UTC(targetYear, targetMonth, Math.min(desiredDay, lastDay))));
}

export function todayIso(): IsoDate {
  const now = new Date();
  return fromUtcDate(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function toUtcDate(date: IsoDate): Date {
  assertIsoDate(date);
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function fromUtcDate(date: Date): IsoDate {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}` as IsoDate;
}
