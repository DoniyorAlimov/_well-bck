import axios, { AxiosError } from "axios";
import * as https from "https";
import PHDQuery from "../constants/PHDQuery";
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

export interface GetDataQuery {
  TagName: string;
  TimeFormat?: number;
  StartTime: string;
  EndTime: string;
  RawData?: boolean;
  // Semicolon-separated, e.g. "Average;Minimum;Maximum" — see
  // pim5401.pdf "GetData" parameters.
  ReductionData?: string;
  ReductionInterval?: number;
  OutputTimeFormat: number;
  // Only required for interpolated (non-raw, non-reduction) queries — see
  // pim5401.pdf "GetData" parameters.
  SampleInterval?: number;
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

export interface GetDataBatchRawQuery {
  TagName: string[];
  StartTime: string;
  EndTime: string;
  TimeFormat?: number;
  OutputTimeFormat: number;
  MinimumConfidence: number;
  RawData?: boolean;
  // Omit both RawData and SampleInterval-less-ness at once: pass exactly
  // one of RawData=true or a SampleInterval, per pim5401.pdf ("RawData"
  // required for raw, "SampleInterval" required for interpolated data).
  SampleInterval?: number;
}

export interface GetDataBatchRawResponse {
  TagName: string;
  TagNumber: number;
  Units?: string;
  TimeStamp: string[];
  Value: number[];
  Confidence: number[];
}

// Batched raw or interpolated fetch: every requested tag in a single POST
// call (arrays only work via POST, per pim5401.pdf — GET is one tag per
// call), mirroring the pattern already used for the nightly sync job's
// reduction batching (getDataBatch below), but for raw/SampleInterval data
// instead of a ReductionData reduction.
//
// Pass sampleIntervalMs to get one interpolated value per that interval
// across the whole StartTime/EndTime window (PHD's "Interpolated" mode);
// omit it for RawData=true (actual stored samples, no resampling).
//
// Verified against the live server (v430.1.2.1): 5 tags x ~18h raw data
// (~6.4k points/tag at a 10s native scan rate) returned in ~400ms; the
// SampleInterval variants over the same window returned in ~50ms. Unlike
// getDataBatch's reduction case, no hang was observed here for a
// single-day-scale window, but this hasn't been tested over multi-day/week
// windows with many tags — treat wide custom ranges with caution.
export const getBatchRawData = async (
  tagNames: string[],
  startTime: string,
  endTime: string,
  sampleIntervalMs?: number
): Promise<GetDataBatchRawResponse[]> => {
  const axiosInstance = await createAxiosInstance();

  const body: GetDataBatchRawQuery = {
    TagName: tagNames,
    StartTime: startTime,
    EndTime: endTime,
    TimeFormat: 6,
    OutputTimeFormat: PHDQuery.OutputTimeFormat,
    MinimumConfidence: PHDQuery.MinimumConfidence,
    ...(sampleIntervalMs ? { SampleInterval: sampleIntervalMs } : { RawData: true }),
  };

  const res = await axiosInstance.post<GetDataBatchRawResponse[]>("/GetData", [body]);
  return res.data;
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
