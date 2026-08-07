import { ClassifiedRow, DELETE_KEYWORD, ImportContext, ImportError, ParsedRow, RowKind } from "./types";

export interface ClassifyResult {
  classified: ClassifiedRow[];
  errors: ImportError[];
}

// Decides what each row means against current DB state — create a new tag,
// update/rename an existing one, or delete it — and catches the row-level
// problems that would make that decision ambiguous (missing tagname,
// duplicate tagname within the file).
export const classifyRows = (parsedRows: ParsedRow[], context: ImportContext): ClassifyResult => {
  const errors: ImportError[] = [];
  const classified: ClassifiedRow[] = [];
  const seenTagnames = new Set<string>();

  parsedRows.forEach((row) => {
    if (!row.tagname) {
      errors.push({ row: row.rowNumber, message: "'Tagname' is required." });
      return;
    }
    if (seenTagnames.has(row.tagname)) {
      errors.push({ row: row.rowNumber, message: `Duplicate 'Tagname' '${row.tagname}' in this file.` });
      return;
    }
    seenTagnames.add(row.tagname);

    const existing = context.byTagname.get(row.tagname);
    let kind: RowKind;
    if (!existing) kind = "create";
    else if (row.newTagname?.toLowerCase() === DELETE_KEYWORD) kind = "delete";
    else kind = "update";

    const finalTagname = kind === "update" && row.newTagname ? row.newTagname : row.tagname;

    classified.push({ ...row, kind, finalTagname });
  });

  return { classified, errors };
};
