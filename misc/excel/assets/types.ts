export const SHEET_NAME = "Assets";
export const TYPES_SHEET_NAME = "Asset Types";
export const HEADERS = ["Asset Name", "New Name", "Parent Asset Name", "Asset Type"];
export const DELETE_KEYWORD = "delete";

// Second, independent sheet in the same workbook: one row per existing
// Attribute, letting the user assign/clear its PHD Tag via a dropdown
// without touching the Assets sheet at all.
export const TAGS_SHEET_NAME = "Attribute Tags";
export const PHD_TAGS_SHEET_NAME = "PHD Tags";
export const TAGS_HEADERS = ["Asset Name", "Attribute Name", "Unit", "PHD Tag"];

export interface ParsedRow {
  rowNumber: number;
  name: string;
  newName: string | null;
  parentName: string | null;
  typeName: string | null;
}

export type RowKind = "create" | "update" | "delete";

export interface ClassifiedRow extends ParsedRow {
  kind: RowKind;
  finalName: string;
}

export interface ImportError {
  row: number;
  message: string;
}

export interface AssetSnapshot {
  id: number;
  name: string;
  parentAssetId: number | null;
}

export interface UtilityTypeSnapshot {
  id: number;
  name: string;
}

// Everything the classify/validate/apply steps need to know about current DB
// state, fetched once by the route handler so each step stays a function of
// its inputs instead of every step querying prisma itself.
export interface ImportContext {
  assets: AssetSnapshot[];
  byName: Map<string, AssetSnapshot>;
  byId: Map<number, AssetSnapshot>;
  utilityTypeByLowerName: Map<string, UtilityTypeSnapshot>;
}

export interface ParsedTagRow {
  rowNumber: number;
  assetName: string;
  attributeName: string;
  // null means "leave/clear blank" — the row's PHD Tag cell was empty.
  tagName: string | null;
}

// Identity for matching a "Attribute Tags" row against the current DB state:
// Attribute has no unique name of its own, so (asset name, attribute name)
// is what a row in the sheet actually refers to.
export const attributeKey = (assetName: string, attributeName: string) => `${assetName}::${attributeName}`;

export interface AttributeSnapshot {
  id: number;
  currentTagId: number | null;
}

export interface PHDTagSnapshot {
  id: number;
  tagname: string;
}

export interface TagImportContext {
  attributeByKey: Map<string, AttributeSnapshot>;
  tagByLowerName: Map<string, PHDTagSnapshot>;
}
