import { ClassifiedRow, compositeKey, DELETE_KEYWORD, ImportContext, ImportError, ParsedRow, RowKind } from "./types";

export interface ClassifyResult {
  classified: ClassifiedRow[];
  errors: ImportError[];
}

// Decides what each row means against current DB state — create a new
// attribute type, update/rename an existing one, or delete it — and catches
// the row-level problems that would make that decision ambiguous (missing
// name, duplicate Name+Asset Type within the file). Identity is the
// (name, resolved asset type) pair, since the same name can legitimately
// exist under different asset types.
export const classifyRows = (parsedRows: ParsedRow[], context: ImportContext): ClassifyResult => {
  const errors: ImportError[] = [];
  const classified: ClassifiedRow[] = [];
  const seenKeys = new Set<string>();

  parsedRows.forEach((row) => {
    if (!row.name) {
      errors.push({ row: row.rowNumber, message: "'Name' is required." });
      return;
    }

    const dedupeKey = `${row.name}::${row.assetTypeName?.toLowerCase() ?? ""}`;
    if (seenKeys.has(dedupeKey)) {
      errors.push({ row: row.rowNumber, message: `Duplicate 'Name' + 'Asset Type' combination in this file.` });
      return;
    }
    seenKeys.add(dedupeKey);

    const utilityType = row.assetTypeName
      ? context.utilityTypeByLowerName.get(row.assetTypeName.toLowerCase())
      : undefined;
    const existing = utilityType
      ? context.byNameAndUtilityTypeId.get(compositeKey(row.name, utilityType.id))
      : undefined;

    let kind: RowKind;
    if (!existing) kind = "create";
    else if (row.newName?.toLowerCase() === DELETE_KEYWORD) kind = "delete";
    else kind = "update";

    const finalName = kind === "update" && row.newName ? row.newName : row.name;

    classified.push({
      ...row,
      kind,
      finalName,
      utilityTypeId: utilityType?.id ?? null,
      existingId: existing?.id ?? null,
    });
  });

  return { classified, errors };
};
