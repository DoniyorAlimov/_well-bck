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
export const parseAttributeTypesWorksheet = (worksheet: Worksheet): ParseResult => {
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
    const description = cellText(values[3]);
    const unitName = cellText(values[4]);
    const assetTypeName = cellText(values[5]);

    // Skip fully blank rows (common trailing rows in a template).
    if (!name && !newName && !description && !unitName && !assetTypeName) continue;

    rows.push({ rowNumber: r, name: name ?? "", newName, description, unitName, assetTypeName });
  }

  return { rows };
};
