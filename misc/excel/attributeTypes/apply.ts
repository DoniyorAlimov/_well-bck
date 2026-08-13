import { Prisma } from "@prisma/client";
import { reconcileAssetAttributesForUtilityTypes } from "../../../lib/attributeReconciliation";
import { ClassifiedRow, ImportContext } from "./types";

export interface ImportSummary {
  created: number;
  updated: number;
  deleted: number;
}

// Attribute types are a flat list — no parent/child relationships — so
// unlike the asset importer this needs no dependency ordering: creates,
// updates, and deletes each just run in file order. An "update" row never
// moves an attribute type to a different asset type (that's part of its
// matching identity, see classify.ts) — to reassign one, delete it here and
// create a new row under the new asset type. Once every row is applied,
// every touched UtilityType gets its assets' Attribute rows reconciled.
export const applyImport = async (
  tx: Prisma.TransactionClient,
  classified: ClassifiedRow[],
  context: ImportContext
): Promise<ImportSummary> => {
  const createRows = classified.filter((r) => r.kind === "create");
  const updateRows = classified.filter((r) => r.kind === "update");
  const deleteRows = classified.filter((r) => r.kind === "delete");

  const touchedUtilityTypeIds = new Set<number>();

  for (const row of createRows) {
    const unit = row.unitName ? context.unitByLowerName.get(row.unitName.toLowerCase()) : undefined;
    await tx.attributeType.create({
      data: {
        name: row.name,
        description: row.description!,
        unitId: unit?.id ?? null,
        utilityTypeId: row.utilityTypeId!,
      },
    });
    touchedUtilityTypeIds.add(row.utilityTypeId!);
  }

  for (const row of updateRows) {
    const existing = context.byId.get(row.existingId!)!;
    const unit = row.unitName ? context.unitByLowerName.get(row.unitName.toLowerCase()) : undefined;
    await tx.attributeType.update({
      where: { id: existing.id },
      data: {
        name: row.finalName,
        description: row.description!,
        unitId: unit?.id ?? null,
      },
    });
    touchedUtilityTypeIds.add(existing.utilityTypeId);
  }

  for (const row of deleteRows) {
    const existing = context.byId.get(row.existingId!)!;
    // The AttributeType <- Attribute relation has no onDelete: Cascade, so
    // any leftover Attribute instances must be cleared explicitly or the
    // delete below would violate the FK constraint. Safe because validate.ts
    // already rejected this row if any of those Attributes had a live
    // Assignment.
    await tx.attribute.deleteMany({ where: { attributeTypeId: existing.id } });
    await tx.attributeType.delete({ where: { id: existing.id } });
    touchedUtilityTypeIds.add(existing.utilityTypeId);
  }

  await reconcileAssetAttributesForUtilityTypes(tx, touchedUtilityTypeIds);

  return { created: createRows.length, updated: updateRows.length, deleted: deleteRows.length };
};
