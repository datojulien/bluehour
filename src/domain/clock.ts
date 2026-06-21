import type { IsoDate, UtcIsoTimestamp } from "./types";

export interface BluehourClock {
  today(): IsoDate;
  now(): UtcIsoTimestamp;
}

export const demoClock: BluehourClock = {
  today: () => "2026-07-12",
  now: () => "2026-07-12T08:00:00.000Z"
};

export const browserLocalClock: BluehourClock = {
  today: browserLocalToday,
  now: () => new Date().toISOString()
};

export function browserLocalToday(date = new Date()): IsoDate {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}` as IsoDate;
}
