import { Prisma } from "@prisma/client";
import { createAssetWithAttributes } from "../../../lib/assetHelpers";
import { ClassifiedRow, ImportContext } from "./types";

export interface ImportSummary {
  created: number;
  updated: number;
  deleted: number;
}

// Persists an already-validated set of rows: creates in dependency order (a
// row can't be created before its in-file parent), then updates, then
// deletes deepest-first so the onDelete: NoAction FK never blocks on a child
// that's also scheduled for deletion in this same batch.
export const applyImport = async (
  tx: Prisma.TransactionClient,
  classified: ClassifiedRow[],
  context: ImportContext
): Promise<ImportSummary> => {
  const createRows = classified.filter((r) => r.kind === "create");
  const updateRows = classified.filter((r) => r.kind === "update");
  const deleteRows = classified.filter((r) => r.kind === "delete");

  // Ids never change on rename, so keying this by each asset's original
  // "Asset Name" keeps every row's Parent Asset Name reference valid
  // throughout the transaction, regardless of processing order.
  const idByCurrentName = new Map<string, number>(context.assets.map((a) => [a.name, a.id]));
  const resolveParentId = (parentName: string | null) =>
    parentName ? idByCurrentName.get(parentName) ?? null : null;

  let pendingCreates = [...createRows];
  while (pendingCreates.length) {
    const ready = pendingCreates.filter((r) => !r.parentName || idByCurrentName.has(r.parentName));
    if (!ready.length) {
      throw new Error("Unable to resolve asset creation order.");
    }
    for (const row of ready) {
      const utilityType = context.utilityTypeByLowerName.get(row.typeName!.toLowerCase())!;
      const newAsset = await createAssetWithAttributes(tx, {
        name: row.name,
        parentAssetId: resolveParentId(row.parentName),
        utilityTypeId: utilityType.id,
      });
      idByCurrentName.set(row.name, newAsset.id);
    }
    pendingCreates = pendingCreates.filter((r) => !ready.includes(r));
  }

  for (const row of updateRows) {
    const existing = context.byName.get(row.name)!;
    const utilityType = context.utilityTypeByLowerName.get(row.typeName!.toLowerCase())!;
    await tx.asset.update({
      where: { id: existing.id },
      data: {
        name: row.finalName,
        parentAssetId: resolveParentId(row.parentName),
        utilityTypeId: utilityType.id,
      },
    });
  }

  let pendingDeletes = [...deleteRows];
  while (pendingDeletes.length) {
    const remainingIds = new Set(pendingDeletes.map((r) => context.byName.get(r.name)!.id));
    const ready = pendingDeletes.filter((r) => {
      const id = context.byName.get(r.name)!.id;
      return !context.assets.some((a) => a.parentAssetId === id && remainingIds.has(a.id));
    });
    if (!ready.length) {
      throw new Error("Unable to resolve asset deletion order.");
    }
    for (const row of ready) {
      await tx.asset.delete({ where: { id: context.byName.get(row.name)!.id } });
    }
    pendingDeletes = pendingDeletes.filter((r) => !ready.includes(r));
  }

  return { created: createRows.length, updated: updateRows.length, deleted: deleteRows.length };
};
