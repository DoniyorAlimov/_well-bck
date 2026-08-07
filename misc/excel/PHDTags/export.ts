import ExcelJs from "exceljs";
import { Request, Response } from "express";
import { prisma } from "../../../prisma/client";
import { HEADERS, SHEET_NAME, UNITS_SHEET_NAME } from "./types";

// Builds and streams the export workbook — the read-side counterpart to
// importFromExcel, kept separate since it has nothing to do with parsing,
// validating, or applying an upload.
export const exportToExcel = async (req: Request, res: Response) => {
  const workbook = new ExcelJs.Workbook();
  const worksheet = workbook.addWorksheet(SHEET_NAME);
  worksheet.addRow(HEADERS);

  const tags = await prisma.pHDTag.findMany({ include: { unit: true }, orderBy: { tagname: "asc" } });
  tags.forEach((tag) => worksheet.addRow([tag.tagname, "", tag.unit.name]));

  const units = await prisma.unit.findMany({ orderBy: { name: "asc" } });
  const unitsSheet = workbook.addWorksheet(UNITS_SHEET_NAME);
  unitsSheet.addRow(["Unit"]);
  units.forEach((unit) => unitsSheet.addRow([unit.name]));

  // Dropdown on the "Units" column, sourced from the reference sheet, so
  // re-imports don't fail on typos. Applied a bit past the current row count
  // so rows appended by hand still get the dropdown.
  const lastUnitRow = units.length + 1;
  const lastDataRow = Math.max(tags.length + 1, 1000);
  for (let r = 2; r <= lastDataRow; r++) {
    worksheet.getCell(r, 3).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [`'${UNITS_SHEET_NAME}'!$A$2:$A$${lastUnitRow}`],
    };
  }

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", "attachment; filename=PHDTags.xlsx");

  await workbook.xlsx.write(res);
  res.end();
};
