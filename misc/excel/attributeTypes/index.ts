import ExcelJs from "exceljs";
import { Request, Response } from "express";
import { prisma } from "../../../prisma/client";
import { attributeTypeLogger, attributeTypesLogPath, deleteLog } from "../../logger";
import { applyImport } from "./apply";
import { classifyRows } from "./classify";
import { parseAttributeTypesWorksheet } from "./parse";
import { AttributeTypeSnapshot, compositeKey, ImportContext, SHEET_NAME } from "./types";
import { validateRows } from "./validate";

export { exportToExcel } from "./export";

const loadImportContext = async (): Promise<ImportContext> => {
  const [attributeTypes, units, utilityTypes] = await Promise.all([
    prisma.attributeType.findMany({
      include: { attributes: { select: { _count: { select: { assignments: true } } } } },
    }),
    prisma.unit.findMany(),
    prisma.utilityType.findMany(),
  ]);

  const snapshots: AttributeTypeSnapshot[] = attributeTypes.map((at) => ({
    id: at.id,
    name: at.name,
    utilityTypeId: at.utilityTypeId,
    assignmentCount: at.attributes.reduce((sum, a) => sum + a._count.assignments, 0),
  }));

  return {
    byId: new Map(snapshots.map((s) => [s.id, s])),
    byNameAndUtilityTypeId: new Map(snapshots.map((s) => [compositeKey(s.name, s.utilityTypeId), s])),
    unitByLowerName: new Map(units.map((u) => [u.name.toLowerCase(), u])),
    utilityTypeByLowerName: new Map(utilityTypes.map((t) => [t.name.toLowerCase(), t])),
  };
};

// Orchestrates the import pipeline (parse -> classify -> validate -> apply)
// and owns the HTTP/logging concerns — status codes, request/response, what
// gets written to the attribute types import log. It contains no parsing,
// classification, validation, or persistence logic itself.
export const importFromExcel = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).send({ message: "No file uploaded" });
    }

    deleteLog(attributeTypesLogPath);

    const workbook = new ExcelJs.Workbook();
    await workbook.xlsx.load(req.file.buffer as any);
    const worksheet = workbook.getWorksheet(SHEET_NAME);
    if (!worksheet) {
      return res.status(400).send({ message: `Worksheet "${SHEET_NAME}" not found.` });
    }

    const parsed = parseAttributeTypesWorksheet(worksheet);
    if ("headerError" in parsed) {
      attributeTypeLogger.error(parsed.headerError);
      return res.status(400).send({ message: parsed.headerError });
    }

    const context = await loadImportContext();
    const { classified, errors: classifyErrors } = classifyRows(parsed.rows, context);
    const errors = [...classifyErrors, ...validateRows(classified, context)];

    if (errors.length) {
      attributeTypeLogger.error(`Import rejected with ${errors.length} error(s): ${JSON.stringify(errors)}`);
      return res.status(400).send({ message: `Import failed with ${errors.length} error(s).`, errors });
    }

    const summary = await prisma.$transaction((tx) => applyImport(tx, classified, context));

    attributeTypeLogger.info(
      `Import completed: ${summary.created} created, ${summary.updated} updated, ${summary.deleted} deleted.`
    );
    res.status(201).send(summary);
  } catch (error) {
    attributeTypeLogger.error(error instanceof Error ? error.stack ?? error.message : String(error));
    res.status(500).send({ message: "An unexpected error occurred while importing the file." });
  }
};
