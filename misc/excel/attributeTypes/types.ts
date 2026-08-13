export const SHEET_NAME = "Attribute Types";
export const ASSET_TYPES_SHEET_NAME = "Asset Types";
export const UNITS_SHEET_NAME = "Units";
export const HEADERS = ["Name", "New Name", "Description", "Data Type", "Unit", "Asset Type"];
export const DELETE_KEYWORD = "delete";
// Matches AttributeType.name/description @db.VarChar(255) in schema.prisma.
export const MAX_NAME_LENGTH = 255;
export const MAX_DESCRIPTION_LENGTH = 255;

export interface ParsedRow {
  rowNumber: number;
  name: string;
  newName: string | null;
  description: string | null;
  dataType: string | null;
  unitName: string | null;
  assetTypeName: string | null;
}

export type RowKind = "create" | "update" | "delete";

export interface ClassifiedRow extends ParsedRow {
  kind: RowKind;
  finalName: string;
  // Resolved from `assetTypeName`; null only when it didn't resolve to a
  // known UtilityType (validate.ts turns that into a row error).
  utilityTypeId: number | null;
  // id of the matched existing AttributeType row (same Name + Asset Type),
  // if any — set for "update"/"delete" rows, null for "create".
  existingId: number | null;
}

export interface ImportError {
  row: number;
  message: string;
}

// Each asset type owns its own attribute definitions (AttributeType.name is
// unique per utilityTypeId, not globally), so identity for matching a row
// against the current DB state is the (name, utilityTypeId) pair.
export interface AttributeTypeSnapshot {
  id: number;
  name: string;
  utilityTypeId: number;
  assignmentCount: number;
}

export interface UnitSnapshot {
  id: number;
  name: string;
}

export interface UtilityTypeSnapshot {
  id: number;
  name: string;
}

export const compositeKey = (name: string, utilityTypeId: number) => `${name}::${utilityTypeId}`;

// Everything the classify/validate/apply steps need to know about current DB
// state, fetched once by the route handler so each step stays a function of
// its inputs instead of every step querying prisma itself.
export interface ImportContext {
  byId: Map<number, AttributeTypeSnapshot>;
  byNameAndUtilityTypeId: Map<string, AttributeTypeSnapshot>;
  unitByLowerName: Map<string, UnitSnapshot>;
  utilityTypeByLowerName: Map<string, UtilityTypeSnapshot>;
}
