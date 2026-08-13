import ExcelJs from "exceljs";
import { Request, Response } from "express";
import { prisma } from "../../../prisma/client";
import { ASSET_TYPES_SHEET_NAME, HEADERS, SHEET_NAME, UNITS_SHEET_NAME } from "./types";

// Builds and streams the export workbook — the read-side counterpart to
// importFromExcel, kept separate since it has nothing to do with parsing,
// validating, or applying an upload.
export const exportToExcel = async (req: Request, res: Response) => {
  const workbook = new ExcelJs.Workbook();
  const worksheet = workbook.addWorksheet(SHEET_NAME);
  worksheet.addRow(HEADERS);

  const [attributeTypes, units, utilityTypes] = await Promise.all([
    prisma.attributeType.findMany({
      include: { utilityType: true },
      orderBy: [{ utilityType: { name: "asc" } }, { name: "asc" }],
    }),
    // AttributeType.unitId has no Prisma relation to Unit, so the name is
    // resolved here from a plain id -> name map instead of an `include`.
    prisma.unit.findMany(),
    prisma.utilityType.findMany({ orderBy: { name: "asc" } }),
  ]);

  const unitNameById = new Map(units.map((u) => [u.id, u.name]));

  attributeTypes.forEach((at) => {
    worksheet.addRow([
      at.name,
      "",
      at.description,
      at.dataType,
      at.unitId ? unitNameById.get(at.unitId) ?? "" : "",
      at.utilityType.name,
    ]);
  });

  const unitsSheet = workbook.addWorksheet(UNITS_SHEET_NAME);
  unitsSheet.addRow(["Unit"]);
  [...units].sort((a, b) => a.name.localeCompare(b.name)).forEach((unit) => unitsSheet.addRow([unit.name]));

  const assetTypesSheet = workbook.addWorksheet(ASSET_TYPES_SHEET_NAME);
  assetTypesSheet.addRow(["Asset Type"]);
  utilityTypes.forEach((type) => assetTypesSheet.addRow([type.name]));

  // Dropdowns on "Unit" and "Asset Type", sourced from the reference sheets,
  // so re-imports don't fail on typos. Applied a bit past the current row
  // count so rows appended by hand still get them.
  const lastUnitRow = units.length + 1;
  const lastAssetTypeRow = utilityTypes.length + 1;
  const lastDataRow = Math.max(attributeTypes.length + 1, 1000);
  for (let r = 2; r <= lastDataRow; r++) {
    worksheet.getCell(r, 5).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`'${UNITS_SHEET_NAME}'!$A$2:$A$${lastUnitRow}`],
    };
    worksheet.getCell(r, 6).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [`'${ASSET_TYPES_SHEET_NAME}'!$A$2:$A$${lastAssetTypeRow}`],
    };
  }

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", "attachment; filename=AttributeTypes.xlsx");

  await workbook.xlsx.write(res);
  res.end();
};
