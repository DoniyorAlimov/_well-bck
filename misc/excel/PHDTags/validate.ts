import { ClassifiedRow, ImportContext, ImportError, MAX_TAGNAME_LENGTH } from "./types";

// Business-rule validation for an already-classified set of rows: units
// resolve, final tagnames don't collide, and no delete would leave a live
// PHD assignment pointing at a tag that no longer exists.
export const validateRows = (classified: ClassifiedRow[], context: ImportContext): ImportError[] => {
  const errors: ImportError[] = [];
  const nonDeleteRows = classified.filter((r) => r.kind !== "delete");

  classified.forEach((row) => {
    if (row.kind === "create" && row.newTagname) {
      errors.push({
        row: row.rowNumber,
        message: `'New Tagname' was set but no existing tag named '${row.tagname}' was found. Put the desired name directly in 'Tagname' to create a new tag.`,
      });
    }

    if (row.kind !== "delete") {
      if (!row.unitName) {
        errors.push({ row: row.rowNumber, message: "'Units' is required." });
      } else if (!context.unitByLowerName.has(row.unitName.toLowerCase())) {
        errors.push({ row: row.rowNumber, message: `Unknown 'Units' '${row.unitName}'.` });
      }
      if (row.finalTagname.length > MAX_TAGNAME_LENGTH) {
        errors.push({
          row: row.rowNumber,
          message: `'Tagname'/'New Tagname' must be ${MAX_TAGNAME_LENGTH} characters or fewer.`,
        });
      }
    }
  });

  errors.push(...validateFinalTagnameUniqueness(nonDeleteRows, context));
  errors.push(...validateDeletesAreSafe(classified, context));

  return errors;
};

const validateFinalTagnameUniqueness = (rows: ClassifiedRow[], context: ImportContext): ImportError[] => {
  const errors: ImportError[] = [];

  const owners = new Map<string, number[]>();
  rows.forEach((row) => {
    const rowNumbers = owners.get(row.finalTagname) ?? [];
    rowNumbers.push(row.rowNumber);
    owners.set(row.finalTagname, rowNumbers);
  });
  owners.forEach((rowNumbers, finalTagname) => {
    if (rowNumbers.length > 1) {
      rowNumbers.forEach((rn) =>
        errors.push({
          row: rn,
          message: `'${finalTagname}' is used as the final tagname for multiple rows (${rowNumbers.join(", ")}).`,
        })
      );
    }
  });

  rows.forEach((row) => {
    if (row.finalTagname !== row.tagname && context.byTagname.has(row.finalTagname)) {
      errors.push({ row: row.rowNumber, message: `A tag named '${row.finalTagname}' already exists.` });
    }
  });

  return errors;
};

const validateDeletesAreSafe = (classified: ClassifiedRow[], context: ImportContext): ImportError[] => {
  const errors: ImportError[] = [];

  // Mirrors the single-tag DELETE /:id rule (routes/PHDTags.ts): a tag with
  // live PHD assignments can't be removed, since Assignment.PHDTag has no
  // cascade and would otherwise fail at the DB level mid-transaction.
  classified
    .filter((r) => r.kind === "delete")
    .forEach((row) => {
      const existing = context.byTagname.get(row.tagname)!;
      if (existing.assignmentCount > 0) {
        errors.push({
          row: row.rowNumber,
          message: `Cannot delete '${row.tagname}': it has ${existing.assignmentCount} attribute assignment(s). Remove them first.`,
        });
      }
    });

  return errors;
};
