import { ClassifiedRow, ImportContext, ImportError } from "./types";

// Business-rule validation for an already-classified set of rows: type names
// resolve, final names don't collide, parents resolve without forming a
// cycle, and no delete would silently orphan a child.
export const validateRows = (
  classified: ClassifiedRow[],
  rowsByName: Map<string, ClassifiedRow>,
  context: ImportContext
): ImportError[] => {
  const errors: ImportError[] = [];
  const nonDeleteRows = classified.filter((r) => r.kind !== "delete");

  classified.forEach((row) => {
    if (row.kind === "create" && row.newName) {
      errors.push({
        row: row.rowNumber,
        message: `'New Name' was set but no existing asset named '${row.name}' was found. Put the desired name directly in 'Asset Name' to create a new asset.`,
      });
    }

    if (row.kind !== "delete") {
      if (!row.typeName) {
        errors.push({ row: row.rowNumber, message: "'Asset Type' is required." });
      } else if (!context.utilityTypeByLowerName.has(row.typeName.toLowerCase())) {
        errors.push({ row: row.rowNumber, message: `Unknown 'Asset Type' '${row.typeName}'.` });
      }
      if (row.finalName.length > 255) {
        errors.push({ row: row.rowNumber, message: "'Asset Name'/'New Name' must be 255 characters or fewer." });
      }
    }
  });

  errors.push(...validateFinalNameUniqueness(nonDeleteRows, context));
  errors.push(...validateParents(nonDeleteRows, rowsByName, context));
  errors.push(...validateDeletesAreSafe(classified, rowsByName, context));

  return errors;
};

const validateFinalNameUniqueness = (rows: ClassifiedRow[], context: ImportContext): ImportError[] => {
  const errors: ImportError[] = [];

  const finalNameOwners = new Map<string, number[]>();
  rows.forEach((row) => {
    const owners = finalNameOwners.get(row.finalName) ?? [];
    owners.push(row.rowNumber);
    finalNameOwners.set(row.finalName, owners);
  });
  finalNameOwners.forEach((rowNumbers, finalName) => {
    if (rowNumbers.length > 1) {
      rowNumbers.forEach((rn) =>
        errors.push({
          row: rn,
          message: `'${finalName}' is used as the final name for multiple rows (${rowNumbers.join(", ")}).`,
        })
      );
    }
  });

  rows.forEach((row) => {
    if (row.finalName !== row.name && context.byName.has(row.finalName)) {
      errors.push({ row: row.rowNumber, message: `An asset named '${row.finalName}' already exists.` });
    }
  });

  return errors;
};

const validateParents = (
  rows: ClassifiedRow[],
  rowsByName: Map<string, ClassifiedRow>,
  context: ImportContext
): ImportError[] => {
  const errors: ImportError[] = [];

  // Walks the combined file+DB graph using each node's *current* ("Asset
  // Name") identifier — New Name never appears as a parent reference, so
  // renames don't break sibling rows that point at it.
  const resolveAncestorName = (name: string): string | null => {
    const fileRow = rowsByName.get(name);
    if (fileRow && fileRow.kind !== "delete") return fileRow.parentName;
    const existing = context.byName.get(name);
    if (!existing || existing.parentAssetId == null) return null;
    return context.byId.get(existing.parentAssetId)?.name ?? null;
  };

  const wouldCreateCycle = (rowName: string, proposedParentName: string): boolean => {
    let current: string | null = proposedParentName;
    const visited = new Set<string>();
    while (current) {
      if (current === rowName) return true;
      if (visited.has(current)) return false;
      visited.add(current);
      current = resolveAncestorName(current);
    }
    return false;
  };

  rows.forEach((row) => {
    if (!row.parentName) return;

    if (row.parentName === row.name) {
      errors.push({ row: row.rowNumber, message: "An asset cannot be its own parent." });
      return;
    }

    const parentInFile = rowsByName.get(row.parentName);
    const parentExisting = context.byName.get(row.parentName);
    if (!parentInFile && !parentExisting) {
      errors.push({ row: row.rowNumber, message: `Unknown 'Parent Asset Name' '${row.parentName}'.` });
      return;
    }
    if (parentInFile?.kind === "delete") {
      errors.push({
        row: row.rowNumber,
        message: `'Parent Asset Name' '${row.parentName}' is marked for deletion.`,
      });
      return;
    }
    if (wouldCreateCycle(row.name, row.parentName)) {
      errors.push({
        row: row.rowNumber,
        message: `Setting '${row.parentName}' as the parent of '${row.name}' would create a cycle.`,
      });
    }
  });

  return errors;
};

const validateDeletesAreSafe = (
  classified: ClassifiedRow[],
  rowsByName: Map<string, ClassifiedRow>,
  context: ImportContext
): ImportError[] => {
  const errors: ImportError[] = [];

  // A delete row is only safe if every current DB child is either also
  // being deleted, or being reparented away by an update row in this file.
  classified
    .filter((r) => r.kind === "delete")
    .forEach((row) => {
      const existing = context.byName.get(row.name)!;
      const children = context.assets.filter((a) => a.parentAssetId === existing.id);
      children.forEach((child) => {
        const childRow = rowsByName.get(child.name);
        const stillAChild = !childRow || (childRow.kind !== "delete" && childRow.parentName === row.name);
        if (stillAChild) {
          errors.push({
            row: row.rowNumber,
            message: `Cannot delete '${row.name}': it still has a child ('${child.name}') that is not marked for deletion.`,
          });
        }
      });
    });

  return errors;
};
