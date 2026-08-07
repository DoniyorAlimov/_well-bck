import { Prisma } from "@prisma/client";
import { ClassifiedRow, ImportContext } from "./types";

export interface ImportSummary {
  created: number;
  updated: number;
  deleted: number;
}

// PHD tags are a flat list — no parent/child relationships — so unlike the
// asset importer this needs no dependency ordering: creates, updates, and
// deletes each just run in file order.
export const applyImport = async (
  tx: Prisma.TransactionClient,
  classified: ClassifiedRow[],
  context: ImportContext
): Promise<ImportSummary> => {
  const createRows = classified.filter((r) => r.kind === "create");
  const updateRows = classified.filter((r) => r.kind === "update");
  const deleteRows = classified.filter((r) => r.kind === "delete");

  for (const row of createRows) {
    const unit = context.unitByLowerName.get(row.unitName!.toLowerCase())!;
    await tx.pHDTag.create({ data: { tagname: row.tagname, unitId: unit.id } });
  }

  for (const row of updateRows) {
    const existing = context.byTagname.get(row.tagname)!;
    const unit = context.unitByLowerName.get(row.unitName!.toLowerCase())!;
    await tx.pHDTag.update({
      where: { id: existing.id },
      data: { tagname: row.finalTagname, unitId: unit.id },
    });
  }

  for (const row of deleteRows) {
    const existing = context.byTagname.get(row.tagname)!;
    await tx.pHDTag.delete({ where: { id: existing.id } });
  }

  return { created: createRows.length, updated: updateRows.length, deleted: deleteRows.length };
};
