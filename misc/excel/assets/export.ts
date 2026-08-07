import ExcelJs from "exceljs";
import { Request, Response } from "express";
import { prisma } from "../../../prisma/client";
import { HEADERS, SHEET_NAME, TYPES_SHEET_NAME } from "./types";

// Builds and streams the export workbook — the read-side counterpart to
// importFromExcel, kept separate since it has nothing to do with parsing,
// validating, or applying an upload.
export const exportToExcel = async (req: Request, res: Response) => {
  const workbook = new ExcelJs.Workbook();
  const worksheet = workbook.addWorksheet(SHEET_NAME);
  worksheet.addRow(HEADERS);

  const assets = await prisma.asset.findMany({
    include: { utilityType: true, parentAsset: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  assets.forEach((asset) => {
    worksheet.addRow([asset.name, "", asset.parentAsset?.name ?? "", asset.utilityType.name]);
  });

  const utilityTypes = await prisma.utilityType.findMany({ orderBy: { name: "asc" } });
  const typesSheet = workbook.addWorksheet(TYPES_SHEET_NAME);
  typesSheet.addRow(["Asset Type"]);
  utilityTypes.forEach((type) => typesSheet.addRow([type.name]));

  // Dropdown on the "Asset Type" column, sourced from the reference sheet, so
  // re-imports don't fail on typos. Applied a bit past the current row count
  // so rows appended by hand still get the dropdown.
  const lastTypeRow = utilityTypes.length + 1;
  const lastDataRow = Math.max(assets.length + 1, 1000);
  for (let r = 2; r <= lastDataRow; r++) {
    worksheet.getCell(r, 4).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [`'${TYPES_SHEET_NAME}'!$A$2:$A$${lastTypeRow}`],
    };
  }

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", "attachment; filename=Assets.xlsx");

  await workbook.xlsx.write(res);
  res.end();
};
