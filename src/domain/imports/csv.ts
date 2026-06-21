import type { IsoDate } from "../types";

export interface CsvParseResult {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export function detectDelimiter(text: string): "," | ";" | "\t" {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  const candidates = [",", ";", "\t"] as const;
  return candidates
    .map((delimiter) => ({ delimiter, count: splitCsvLine(firstLine, delimiter).length }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

export function parseCsv(text: string, delimiter = detectDelimiter(text)): CsvParseResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = splitCsvLine(lines[0], delimiter).map((header) => header.trim());
  const rows = lines.slice(1).map((line) => {
    const values = splitCsvLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""]));
  });

  return { headers, rows };
}

export function parseCsvDate(value: string, format: "YYYY-MM-DD" | "DD/MM/YYYY"): IsoDate {
  if (format === "YYYY-MM-DD") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`Invalid ISO date: ${value}`);
    }
    return value as IsoDate;
  }

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid DD/MM/YYYY date: ${value}`);
  }

  return `${match[3]}-${match[2]}-${match[1]}` as IsoDate;
}

export function escapeCsvCell(value: unknown): string {
  const text = String(value ?? "");
  const escapedFormula = /^[=+\-@]/.test(text) ? `'${text}` : text;
  if (/[",\n\r]/.test(escapedFormula)) {
    return `"${escapedFormula.replace(/"/g, '""')}"`;
  }

  return escapedFormula;
}

export function toCsv(headers: readonly string[], rows: readonly object[]): string {
  return [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvCell((row as Record<string, unknown>)[header])).join(","))
  ].join("\n");
}

export async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}
