import ExcelJs from "exceljs";
import { Request, Response } from "express";
import { prisma } from "../../../prisma/client";
import { PHDTagLogger, PHDTagsLogPath, deleteLog } from "../../logger";
import { applyImport } from "./apply";
import { classifyRows } from "./classify";
import { parsePHDTagsWorksheet } from "./parse";
import { ImportContext, SHEET_NAME, TagSnapshot } from "./types";
import { validateRows } from "./validate";

export { exportToExcel } from "./export";

const loadImportContext = async (): Promise<ImportContext> => {
  const tags = await prisma.pHDTag.findMany({
    select: { id: true, tagname: true, _count: { select: { assignments: true } } },
  });
  const units = await prisma.unit.findMany();

  const snapshots: TagSnapshot[] = tags.map((t) => ({
    id: t.id,
    tagname: t.tagname,
    assignmentCount: t._count.assignments,
  }));

  return {
    byTagname: new Map(snapshots.map((t) => [t.tagname, t])),
    unitByLowerName: new Map(units.map((u) => [u.name.toLowerCase(), u])),
  };
};

// Orchestrates the import pipeline (parse -> classify -> validate -> apply)
// and owns the HTTP/logging concerns — status codes, request/response, what
// gets written to the PHD tags import log. It contains no parsing,
// classification, validation, or persistence logic itself.
export const importFromExcel = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).send({ message: "No file uploaded" });
    }

    deleteLog(PHDTagsLogPath);

    const workbook = new ExcelJs.Workbook();
    await workbook.xlsx.load(req.file.buffer as any);
    const worksheet = workbook.getWorksheet(SHEET_NAME);
    if (!worksheet) {
      return res.status(400).send({ message: `Worksheet "${SHEET_NAME}" not found.` });
    }

    const parsed = parsePHDTagsWorksheet(worksheet);
    if ("headerError" in parsed) {
      PHDTagLogger.error(parsed.headerError);
      return res.status(400).send({ message: parsed.headerError });
    }

    const context = await loadImportContext();
    const { classified, errors: classifyErrors } = classifyRows(parsed.rows, context);
    const errors = [...classifyErrors, ...validateRows(classified, context)];

    if (errors.length) {
      PHDTagLogger.error(`Import rejected with ${errors.length} error(s): ${JSON.stringify(errors)}`);
      return res.status(400).send({ message: `Import failed with ${errors.length} error(s).`, errors });
    }

    const summary = await prisma.$transaction((tx) => applyImport(tx, classified, context));

    PHDTagLogger.info(
      `Import completed: ${summary.created} created, ${summary.updated} updated, ${summary.deleted} deleted.`
    );
    res.status(201).send(summary);
  } catch (error) {
    PHDTagLogger.error(error instanceof Error ? error.stack ?? error.message : String(error));
    res.status(500).send({ message: "An unexpected error occurred while importing the file." });
  }
};
