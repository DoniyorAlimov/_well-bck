export const SHEET_NAME = "Assets";
export const TYPES_SHEET_NAME = "Asset Types";
export const HEADERS = ["Asset Name", "New Name", "Parent Asset Name", "Asset Type"];
export const DELETE_KEYWORD = "delete";

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
