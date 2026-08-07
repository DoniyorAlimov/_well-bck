import ExcelJs from "exceljs";
import { Request, Response } from "express";
import { prisma } from "../../../prisma/client";
import { assetLogger, assetsLogPath, deleteLog } from "../../logger";
import { applyImport } from "./apply";
import { classifyRows } from "./classify";
import { parseAssetsWorksheet } from "./parse";
import { AssetSnapshot, ImportContext, SHEET_NAME } from "./types";
import { validateRows } from "./validate";

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

    deleteLog(assetsLogPath);

    const workbook = new ExcelJs.Workbook();
    await workbook.xlsx.load(req.file.buffer as any);
    const worksheet = workbook.getWorksheet(SHEET_NAME);
    if (!worksheet) {
      return res.status(400).send({ message: `Worksheet "${SHEET_NAME}" not found.` });
    }

    const parsed = parseAssetsWorksheet(worksheet);
    if ("headerError" in parsed) {
      assetLogger.error(parsed.headerError);
      return res.status(400).send({ message: parsed.headerError });
    }

    const context = await loadImportContext();
    const { classified, rowsByName, errors: classifyErrors } = classifyRows(parsed.rows, context);
    const errors = [...classifyErrors, ...validateRows(classified, rowsByName, context)];

    if (errors.length) {
      assetLogger.error(`Import rejected with ${errors.length} error(s): ${JSON.stringify(errors)}`);
      return res.status(400).send({ message: `Import failed with ${errors.length} error(s).`, errors });
    }

    const summary = await prisma.$transaction((tx) => applyImport(tx, classified, context));

    assetLogger.info(
      `Import completed: ${summary.created} created, ${summary.updated} updated, ${summary.deleted} deleted.`
    );
    res.status(201).send(summary);
  } catch (error) {
    assetLogger.error(error instanceof Error ? error.stack ?? error.message : String(error));
    res.status(500).send({ message: "An unexpected error occurred while importing the file." });
  }
};
