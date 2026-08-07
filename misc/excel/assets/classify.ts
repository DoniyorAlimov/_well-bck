import { ClassifiedRow, DELETE_KEYWORD, ImportContext, ImportError, ParsedRow, RowKind } from "./types";

export interface ClassifyResult {
  classified: ClassifiedRow[];
  rowsByName: Map<string, ClassifiedRow>;
  errors: ImportError[];
}

// Decides what each row means against current DB state — create a new
// asset, update/rename an existing one, or delete it — and catches the
// row-level problems that would make that decision ambiguous (missing name,
// duplicate name within the file).
export const classifyRows = (parsedRows: ParsedRow[], context: ImportContext): ClassifyResult => {
  const errors: ImportError[] = [];
  const rowsByName = new Map<string, ClassifiedRow>();
  const classified: ClassifiedRow[] = [];
  const seenNames = new Set<string>();

  parsedRows.forEach((row) => {
    if (!row.name) {
      errors.push({ row: row.rowNumber, message: "'Asset Name' is required." });
      return;
    }
    if (seenNames.has(row.name)) {
      errors.push({ row: row.rowNumber, message: `Duplicate 'Asset Name' '${row.name}' in this file.` });
      return;
    }
    seenNames.add(row.name);

    const existing = context.byName.get(row.name);
    let kind: RowKind;
    if (!existing) kind = "create";
    else if (row.newName?.toLowerCase() === DELETE_KEYWORD) kind = "delete";
    else kind = "update";

    const finalName = kind === "update" && row.newName ? row.newName : row.name;

    const classifiedRow: ClassifiedRow = { ...row, kind, finalName };
    classified.push(classifiedRow);
    rowsByName.set(row.name, classifiedRow);
  });

  return { classified, rowsByName, errors };
};
