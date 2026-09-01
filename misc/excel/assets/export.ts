import ExcelJs from "exceljs";
import { Request, Response } from "express";
import { prisma } from "../../../prisma/client";
import { HEADERS, PHD_TAGS_SHEET_NAME, SHEET_NAME, TAGS_HEADERS, TAGS_SHEET_NAME, TYPES_SHEET_NAME } from "./types";

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

  // Second sheet: one row per existing Attribute, with a "PHD Tag" dropdown
  // so the user can assign/clear tags in the same file without touching the
  // Assets sheet above.
  const attributes = await prisma.attribute.findMany({
    include: {
      asset: { select: { name: true } },
      attributeType: { select: { unitId: true } },
      // Assignment is modeled many-to-many, but POST /assets/assign enforces
      // 1:1 (delete-then-create), so the first row is always "the" tag.
      assignments: { include: { PHDTag: { select: { tagname: true } } } },
    },
    orderBy: [{ asset: { name: "asc" } }, { name: "asc" }],
  });
  const units = await prisma.unit.findMany();
  const unitNameById = new Map(units.map((u) => [u.id, u.name]));

  const tagsSheet = workbook.addWorksheet(TAGS_SHEET_NAME);
  tagsSheet.addRow(TAGS_HEADERS);
  attributes.forEach((attribute) => {
    const unitName = attribute.attributeType.unitId ? unitNameById.get(attribute.attributeType.unitId) ?? "" : "";
    const currentTag = attribute.assignments[0]?.PHDTag.tagname ?? "";
    tagsSheet.addRow([attribute.asset.name, attribute.name, unitName, currentTag]);
  });

  const phdTags = await prisma.pHDTag.findMany({ orderBy: { tagname: "asc" } });
  const phdTagsSheet = workbook.addWorksheet(PHD_TAGS_SHEET_NAME);
  phdTagsSheet.addRow(["PHD Tag"]);
  phdTags.forEach((tag) => phdTagsSheet.addRow([tag.tagname]));

  // Dropdown on the "PHD Tag" column, sourced from the reference sheet.
  // Blank is allowed — it means "no tag assigned" / "clear the assignment".
  const lastTagRow = phdTags.length + 1;
  const lastTagDataRow = Math.max(attributes.length + 1, 1000);
  for (let r = 2; r <= lastTagDataRow; r++) {
    tagsSheet.getCell(r, 4).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`'${PHD_TAGS_SHEET_NAME}'!$A$2:$A$${lastTagRow}`],
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
