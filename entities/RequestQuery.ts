export interface RequestParams {}

export interface ResponseBody {}

export interface RequestBody {}

export interface RequestQuery {
  page: string;
  pageSize: string;
  searchedName: string;
  sortBy?: string;
  sortOrder?: string;
}
