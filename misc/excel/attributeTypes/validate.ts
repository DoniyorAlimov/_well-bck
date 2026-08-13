import { ClassifiedRow, compositeKey, ImportContext, ImportError, MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from "./types";

// Business-rule validation for an already-classified set of rows: required
// fields are present, units and the asset type resolve, final (name, asset
// type) pairs don't collide, and no delete would leave a live Assignment
// pointing at an attribute whose AttributeType no longer exists.
export const validateRows = (classified: ClassifiedRow[], context: ImportContext): ImportError[] => {
  const errors: ImportError[] = [];
  const nonDeleteRows = classified.filter((r) => r.kind !== "delete");

  classified.forEach((row) => {
    if (row.kind === "create" && row.newName) {
      errors.push({
        row: row.rowNumber,
        message: `'New Name' was set but no existing attribute type named '${row.name}' was found for this asset type. Put the desired name directly in 'Name' to create a new attribute type.`,
      });
    }

    if (row.kind !== "delete") {
      if (!row.description) {
        errors.push({ row: row.rowNumber, message: "'Description' is required." });
      } else if (row.description.length > MAX_DESCRIPTION_LENGTH) {
        errors.push({
          row: row.rowNumber,
          message: `'Description' must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`,
        });
      }

      if (!row.dataType) {
        errors.push({ row: row.rowNumber, message: "'Data Type' is required." });
      }

      if (row.unitName && !context.unitByLowerName.has(row.unitName.toLowerCase())) {
        errors.push({ row: row.rowNumber, message: `Unknown 'Unit' '${row.unitName}'.` });
      }

      if (!row.assetTypeName) {
        errors.push({
          row: row.rowNumber,
          message: "'Asset Type' is required — an attribute type must belong to exactly one asset type.",
        });
      } else if (row.utilityTypeId === null) {
        errors.push({ row: row.rowNumber, message: `Unknown 'Asset Type' '${row.assetTypeName}'.` });
      }

      if (row.finalName.length > MAX_NAME_LENGTH) {
        errors.push({
          row: row.rowNumber,
          message: `'Name'/'New Name' must be ${MAX_NAME_LENGTH} characters or fewer.`,
        });
      }
    }
  });

  errors.push(...validateFinalNameUniqueness(nonDeleteRows, context));
  errors.push(...validateDeletesAreSafe(classified, context));

  return errors;
};

const validateFinalNameUniqueness = (rows: ClassifiedRow[], context: ImportContext): ImportError[] => {
  const errors: ImportError[] = [];
  const resolvedRows = rows.filter((r) => r.utilityTypeId !== null);

  const owners = new Map<string, number[]>();
  resolvedRows.forEach((row) => {
    const key = compositeKey(row.finalName, row.utilityTypeId!);
    const rowNumbers = owners.get(key) ?? [];
    rowNumbers.push(row.rowNumber);
    owners.set(key, rowNumbers);
  });
  owners.forEach((rowNumbers) => {
    if (rowNumbers.length > 1) {
      rowNumbers.forEach((rn) =>
        errors.push({
          row: rn,
          message: `This 'Name' + 'Asset Type' combination is used by multiple rows (${rowNumbers.join(", ")}).`,
        })
      );
    }
  });

  resolvedRows.forEach((row) => {
    if (row.finalName === row.name) return; // not a rename, can't collide with a pre-existing row
    const existingInDb = context.byNameAndUtilityTypeId.get(compositeKey(row.finalName, row.utilityTypeId!));
    if (existingInDb && existingInDb.id !== row.existingId) {
      errors.push({
        row: row.rowNumber,
        message: `'${row.finalName}' already exists for asset type '${row.assetTypeName}'.`,
      });
    }
  });

  return errors;
};

const validateDeletesAreSafe = (classified: ClassifiedRow[], context: ImportContext): ImportError[] => {
  const errors: ImportError[] = [];

  // Mirrors the fact that deleting an AttributeType cascades to its
  // Attributes and their Assignments — block it when there's a live
  // Assignment so the deletion is a deliberate choice, not a side effect.
  classified
    .filter((r) => r.kind === "delete" && r.existingId !== null)
    .forEach((row) => {
      const existing = context.byId.get(row.existingId!)!;
      if (existing.assignmentCount > 0) {
        errors.push({
          row: row.rowNumber,
          message: `Cannot delete '${row.name}': it has ${existing.assignmentCount} attribute assignment(s). Remove them first.`,
        });
      }
    });

  return errors;
};
