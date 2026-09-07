import ExcelJs from "exceljs";
import { Request, Response } from "express";
import { prisma } from "../../../prisma/client";
import { assetLogger, assetsLogPath, deleteLog } from "../../logger";
import { applyImport } from "./apply";
import { classifyRows } from "./classify";
import { parseAssetsWorksheet, parseAttributeTagsWorksheet } from "./parse";
import { applyTagAssignments, loadTagImportContext, validateTagRows } from "./tagAssignments";
import { AssetSnapshot, ImportContext, ParsedRow, ParsedTagRow, SHEET_NAME, TAGS_SHEET_NAME } from "./types";
import { validateRows } from "./validate";

// What the uploaded workbook should be applied to. "assets" and "attributes"
// each touch only their own sheet — the other sheet, even if present in the
// file, is left untouched — so a user can re-run just the tag-assignment
// step (say) without their in-progress asset-tree edits being picked up.
type ImportScope = "assets" | "attributes" | "both";
const isImportScope = (value: unknown): value is ImportScope =>
  value === "assets" || value === "attributes" || value === "both";

export { exportToExcel } from "./export";

const loadImportContext = async (): Promise<ImportContext> => {
  const assets: AssetSnapshot[] = await prisma.asset.findMany({
    select: { id: true, name: true, parentAssetId: true },
  });
  const utilityTypes = await prisma.utilityType.findMany();

  return {
    assets,
    byName: new Map(assets.map((a) => [a.name, a])),
    byId: new Map(assets.map((a) => [a.id, a])),
    utilityTypeByLowerName: new Map(utilityTypes.map((t) => [t.name.toLowerCase(), t])),
  };
};

// Orchestrates the import pipeline (parse -> classify -> validate -> apply)
// and owns the HTTP/logging concerns — status codes, request/response,
// what gets written to the asset import log. It contains no parsing,
// classification, validation, or persistence logic itself.
export const importFromExcel = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).send({ message: "No file uploaded" });
    }

    const scope: ImportScope = isImportScope(req.body?.scope) ? req.body.scope : "both";
    const includeAssets = scope !== "attributes";
    const includeAttributes = scope !== "assets";

    deleteLog(assetsLogPath);

    const workbook = new ExcelJs.Workbook();
    await workbook.xlsx.load(req.file.buffer as any);

    let parsedRows: ParsedRow[] = [];
    if (includeAssets) {
      const worksheet = workbook.getWorksheet(SHEET_NAME);
      if (!worksheet) {
        return res.status(400).send({ message: `Worksheet "${SHEET_NAME}" not found.` });
      }
      const parsed = parseAssetsWorksheet(worksheet);
      if ("headerError" in parsed) {
        assetLogger.error(parsed.headerError);
        return res.status(400).send({ message: parsed.headerError });
      }
      parsedRows = parsed.rows;
    }

    let parsedTagRows: ParsedTagRow[] = [];
    if (includeAttributes) {
      const tagsWorksheet = workbook.getWorksheet(TAGS_SHEET_NAME);
      // Required when the caller explicitly scoped the import to
      // "attributes" (that's the only thing the upload can be for); still
      // optional under "both" so older exports without the sheet keep working.
      if (!tagsWorksheet && scope === "attributes") {
        return res.status(400).send({ message: `Worksheet "${TAGS_SHEET_NAME}" not found.` });
      }
      if (tagsWorksheet) {
        const parsedTags = parseAttributeTagsWorksheet(tagsWorksheet);
        if ("headerError" in parsedTags) {
          assetLogger.error(parsedTags.headerError);
          return res.status(400).send({ message: parsedTags.headerError });
        }
        parsedTagRows = parsedTags.rows;
      }
    }

    const context = await loadImportContext();
    const { classified, rowsByName, errors: classifyErrors } = classifyRows(parsedRows, context);
    const errors = [...classifyErrors, ...validateRows(classified, rowsByName, context)];

    const tagContext = await loadTagImportContext();
    errors.push(...validateTagRows(parsedTagRows, tagContext));

    if (errors.length) {
      assetLogger.error(`Import rejected with ${errors.length} error(s): ${JSON.stringify(errors)}`);
      return res.status(400).send({ message: `Import failed with ${errors.length} error(s).`, errors });
    }

    const summary = await prisma.$transaction(async (tx) => {
      const assetSummary = await applyImport(tx, classified, context);
      const tagSummary = await applyTagAssignments(tx, parsedTagRows, tagContext);
      return { ...assetSummary, ...tagSummary };
    });

    assetLogger.info(
      `Import completed: ${summary.created} created, ${summary.updated} updated, ${summary.deleted} deleted, ` +
        `${summary.tagsAssigned} tag(s) assigned, ${summary.tagsCleared} tag(s) cleared.`
    );
    res.status(201).send(summary);
  } catch (error) {
    assetLogger.error(error instanceof Error ? error.stack ?? error.message : String(error));
    res.status(500).send({ message: "An unexpected error occurred while importing the file." });
  }
};
