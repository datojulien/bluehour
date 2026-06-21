import type { RecordMeta } from "./types";

export function createRecordMeta(idPrefix: string): RecordMeta {
  const now = new Date().toISOString();
  return {
    id: `${idPrefix}-${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    revision: 1
  };
}

export function touchRecord<T extends RecordMeta>(record: T): T {
  return {
    ...record,
    updatedAt: new Date().toISOString(),
    revision: record.revision + 1
  };
}
