import axios, { AxiosError, AxiosRequestConfig } from "axios";
import * as https from "https";
import { prisma } from "../prisma/client";

const agent = new https.Agent({
  rejectUnauthorized: false,
});

interface TagListResponse {
  TagNumber: number;
  TagName: string;
  DataType: string;
  DataLength: number;
}

export interface GetDataResponse {
  TagName: string;
  TimeStamp: string[];
  Value: number[];
  Confidence: number[];
}

export interface GetDataQuery {
  TagName: string;
  TimeFormat?: number;
  StartTime: string;
  EndTime: string;
  RawData?: boolean;
  ReductionData?: "Average";
  OutputTimeFormat: number;
  SampleInterval: number;
  MinimumConfidence: number;
  MaxRows?: number;
}

interface AxiosValidationError {
  message: string;
  errors: Record<string, string[]>;
}

export interface HttpError
  extends AxiosError<AxiosValidationError, Record<string, unknown>> {}

// Factory function to create axios instance with dynamic baseURL
const createAxiosInstance = async () => {
  const baseURL = await getBaseUrl();

  const axiosInstance = axios.create({
    baseURL,
    httpsAgent: agent,
    insecureHTTPParser: true,
  });

  return axiosInstance;
};

const getBaseUrl = async () => {
  const dataSource = await prisma.dataSource.findUnique({
    where: { id: 1 },
  });

  if (!dataSource) {
    throw new Error("Could not get datasource");
  }

  return `https://${dataSource.host}:${dataSource.port}`;
};

export const getTags = async () => {
  const axiosInstance = await createAxiosInstance();

  return axiosInstance
    .get<TagListResponse>("/TagList")
    .then((res) => res.data)
    .catch((err) => err);
};

export const getData = async (params: AxiosRequestConfig) => {
  const axiosInstance = await createAxiosInstance();

  return axiosInstance
    .get<GetDataResponse[]>("/GetData", params)
    .then((res) => res.data)
    .catch((err) => err);
};

export interface GetDataBatchQuery {
  TagName: string[];
  StartTime: string;
  EndTime: string;
  TimeFormat?: number;
  OutputTimeFormat: number;
  MinimumConfidence: number;
  SampleInterval: number;
  ReductionData: "avg";
}

export interface GetDataBatchResponse {
  TagName: string;
  TagNumber: number;
  TimeStamp: string[];
  Aggregate: string[];
  Value: number[];
  Tolerance: number[];
  Confidence: number[];
}

// Batched equivalent of getData: PHD's RESTful API only accepts array
// TagName values over POST - GET requests are restricted to a single tag
// (see pim5401.pdf, "RESTful API Requests").
//
// This uses a true ReductionData "avg" reduction (not PHD's "ARRAYS"
// modifier, which live testing showed this server (v430.1.2.1) silently
// ignores - it always falls back to interpolated/resampled points instead
// of real per-interval averages, which measured up to 51% off from the
// true value on some tags). A multi-tag "avg" reduction request over a
// *short* window (e.g. one hour) is fast and stable and returns an exact,
// byte-identical match to the single-tag equivalent; the same request over
// a full *day* window was observed to hang the server for minutes. Callers
// must keep the StartTime/EndTime span short (see getBatchedRecords.ts,
// which loops hour-by-hour) rather than requesting a wide range here.
export const getDataBatch = async (body: GetDataBatchQuery[]) => {
  const axiosInstance = await createAxiosInstance();

  const res = await axiosInstance.post<GetDataBatchResponse[]>(
    "/GetData",
    body
  );
  return res.data;
};
