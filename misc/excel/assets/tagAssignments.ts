import { Prisma } from "@prisma/client";
import { prisma } from "../../../prisma/client";
import {
  attributeKey,
  AttributeSnapshot,
  ImportError,
  ParsedTagRow,
  PHDTagSnapshot,
  TagImportContext,
} from "./types";

// Snapshot of current attributes/tags for validating and applying the
// "Attribute Tags" sheet. Loaded once up front — like loadImportContext for
// the Assets sheet — so rows are only ever checked against attributes that
// already exist in the DB; attributes for assets created earlier in the same
// upload (via the Assets sheet) are out of scope for this step.
export const loadTagImportContext = async (): Promise<TagImportContext> => {
  const [attributes, tags] = await Promise.all([
    prisma.attribute.findMany({
      include: { asset: { select: { name: true } }, assignments: { select: { PHDTagId: true } } },
    }),
    prisma.pHDTag.findMany(),
  ]);

  const attributeByKey = new Map<string, AttributeSnapshot>(
    attributes.map((a) => [
      attributeKey(a.asset.name, a.name),
      { id: a.id, currentTagId: a.assignments[0]?.PHDTagId ?? null },
    ])
  );
  const tagByLowerName = new Map<string, PHDTagSnapshot>(
    tags.map((t) => [t.tagname.toLowerCase(), { id: t.id, tagname: t.tagname }])
  );

  return { attributeByKey, tagByLowerName };
};

// Business-rule validation for the "Attribute Tags" sheet: every row must
// resolve to a known attribute (by Asset Name + Attribute Name) and, unless
// left blank to clear the assignment, a known PHD Tag.
export const validateTagRows = (rows: ParsedTagRow[], context: TagImportContext): ImportError[] => {
  const errors: ImportError[] = [];

  rows.forEach((row) => {
    if (!row.assetName || !row.attributeName) {
      errors.push({ row: row.rowNumber, message: "[Attribute Tags] 'Asset Name' and 'Attribute Name' are required." });
      return;
    }
    if (!context.attributeByKey.has(attributeKey(row.assetName, row.attributeName))) {
      errors.push({
        row: row.rowNumber,
        message: `[Attribute Tags] Unknown attribute '${row.attributeName}' on asset '${row.assetName}'.`,
      });
      return;
    }
    if (row.tagName && !context.tagByLowerName.has(row.tagName.toLowerCase())) {
      errors.push({ row: row.rowNumber, message: `[Attribute Tags] Unknown 'PHD Tag' '${row.tagName}'.` });
    }
  });

  return errors;
};

export interface TagApplySummary {
  tagsAssigned: number;
  tagsCleared: number;
}

// Persists the "Attribute Tags" sheet: each row either (re)assigns a single
// PHD Tag to an attribute or, left blank, clears any existing assignment.
// Mirrors the "enforce 1:1" behavior of POST /assets/assign (delete-then-
// create) so the two entry points can't drift. Rows that already match the
// current assignment are skipped entirely.
export const applyTagAssignments = async (
  tx: Prisma.TransactionClient,
  rows: ParsedTagRow[],
  context: TagImportContext
): Promise<TagApplySummary> => {
  let tagsAssigned = 0;
  let tagsCleared = 0;

  for (const row of rows) {
    const attribute = context.attributeByKey.get(attributeKey(row.assetName, row.attributeName))!;
    const newTagId = row.tagName ? context.tagByLowerName.get(row.tagName.toLowerCase())!.id : null;
    if (newTagId === attribute.currentTagId) continue;

    await tx.assignment.deleteMany({ where: { attributeId: attribute.id } });
    if (newTagId) {
      await tx.assignment.create({ data: { attributeId: attribute.id, PHDTagId: newTagId } });
      tagsAssigned += 1;
    } else {
      tagsCleared += 1;
    }
  }

  return { tagsAssigned, tagsCleared };
};
