import { PHDTag, Prisma } from "@prisma/client";
import _ from "lodash";
import ms from "ms";
import PHDTagExtended from "../../entities/PHDTagExtended";
import { JobLogger } from "../../misc/logger";
import { prisma } from "../../prisma/client";
import { getExactHourlyValuesBatch } from "./getBatchedRecords";
import { getPreviousDayDate, getPreviousDayTime } from "./helperFunctions";

const MAX_RETRIES = 3; // Maximum number of retry attempts
const RETRY_DELAY = ms("5s"); // Delay between retries
const TRANSACTION_TIMEOUT = ms("10m"); // Transaction timeout in milliseconds (10 minutes)

const writeDailyRecords = async () => {
  JobLogger.info("Starting job...");

  // Getting previous date
  const timestamp = getPreviousDayDate();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Start a transaction
      await prisma.$transaction(
        async (tx) => {
          await proceedTags(tx, timestamp);
        },
        { timeout: TRANSACTION_TIMEOUT }
      );

      break; // Break out of the loop if transaction succeeds
    } catch (error) {
      JobLogger.error(`Transaction attempt ${attempt} failed: `, error);
      checkAttempts(attempt, error as Error);

      await makeDelay();
    }
  }
};

const proceedTags = async (tx: Prisma.TransactionClient, timestamp: Date) => {
  const tags: PHDTagExtended[] = await tx.pHDTag.findMany({
    include: { unit: true },
  });

  const previousDay = getPreviousDayTime();

  // Fetch every tag's 24 true hourly averages, batched across tags per
  // hour (24 requests total, chunked internally) instead of one request
  // per tag per hour.
  const hourlyValues = await getExactHourlyValuesBatch(
    tags.map((tag) => tag.tagname),
    previousDay
  );

  for (let tag of tags) {
    const values = hourlyValues.get(tag.tagname) ?? [];
    const value = tag.unit.name === "%" ? _.mean(values) || 0 : _.sum(values);
    await recordValue(tx, tag, value, timestamp);
    logRecord(tag, value);
  }

  logResult(tags);
};

const recordValue = async (
  tx: Prisma.TransactionClient,
  tag: PHDTag,
  value: number | undefined,
  timestamp: Date
) =>
  await tx.record.create({
    data: {
      PHDTagId: tag.id,
      value: value || 0,
      timestamp,
    },
  });

const logRecord = (tag: PHDTagExtended, value: number | undefined) =>
  JobLogger.info(
    `Tagname: ${tag.tagname}, Value: ${
      value ? value : "replaced with 0 since no value provided by PHD"
    }, Units: ${tag.unit.name}`
  );

const logResult = (tags: PHDTag[]) => {
  JobLogger.info(`Added ${tags.length} records`);
  JobLogger.info("Job successfully executed...");
};

const checkAttempts = (attempt: number, error: Error) => {
  if (attempt === MAX_RETRIES) {
    JobLogger.error("All retry attempts failed.");
    throw error; // Re-throw the error after all attempts failed
  }
};

const makeDelay = async () => {
  JobLogger.info(`Retrying transaction in ${RETRY_DELAY / 1000} seconds...`);
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
};

export default writeDailyRecords;
