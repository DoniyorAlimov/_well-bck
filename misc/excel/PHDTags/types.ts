export const SHEET_NAME = "PHD Tags";
export const UNITS_SHEET_NAME = "Units";
export const HEADERS = ["Tagname", "New Tagname", "Units"];
export const DELETE_KEYWORD = "delete";
// Matches PHDTag.tagname @db.VarChar(300) in schema.prisma.
export const MAX_TAGNAME_LENGTH = 300;

export interface ParsedRow {
  rowNumber: number;
  tagname: string;
  newTagname: string | null;
  unitName: string | null;
}

export type RowKind = "create" | "update" | "delete";

export interface ClassifiedRow extends ParsedRow {
  kind: RowKind;
  finalTagname: string;
}

export interface ImportError {
  row: number;
  message: string;
}

export interface TagSnapshot {
  id: number;
  tagname: string;
  assignmentCount: number;
}

export interface UnitSnapshot {
  id: number;
  name: string;
}

// Everything the classify/validate/apply steps need to know about current DB
// state, fetched once by the route handler so each step stays a function of
// its inputs instead of every step querying prisma itself.
export interface ImportContext {
  byTagname: Map<string, TagSnapshot>;
  unitByLowerName: Map<string, UnitSnapshot>;
}
