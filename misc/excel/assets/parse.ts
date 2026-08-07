import { Worksheet } from "exceljs";
import { HEADERS, ParsedRow } from "./types";

const cellText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
};

export type ParseResult = { rows: ParsedRow[] } | { headerError: string };

// Turns an uploaded worksheet into plain row data. This module only knows
// about Excel — it has no opinion on what the rows mean.
export const parseAssetsWorksheet = (worksheet: Worksheet): ParseResult => {
  const headerValues = (worksheet.getRow(1).values as unknown[]) ?? [];
  const headerMismatch = HEADERS.some(
    (expected, i) => cellText(headerValues[i + 1])?.toLowerCase() !== expected.toLowerCase()
  );
  if (headerMismatch) {
    return { headerError: `Invalid headers. Expected: ${HEADERS.join(", ")}` };
  }

  const rows: ParsedRow[] = [];
  for (let r = 2; r <= worksheet.rowCount; r++) {
    const values = worksheet.getRow(r).values as unknown[];
    const name = cellText(values[1]);
    const newName = cellText(values[2]);
    const parentName = cellText(values[3]);
    const typeName = cellText(values[4]);

    // Skip fully blank rows (common trailing rows in a template).
    if (!name && !newName && !parentName && !typeName) continue;

    rows.push({ rowNumber: r, name: name ?? "", newName, parentName, typeName });
  }

  return { rows };
};
