import moment from "moment";
import { DateTimeFormat } from "../../constants/DateTimeFormats";
import { JobLogger } from "../../misc/logger";
import { writeRecordsForDay } from "./writeDailyRecords";

// Backfills every whole calendar day from `startDate` to `endDate`
// (inclusive), by re-running the same per-day fetch the nightly job uses —
// one day at a time, oldest first, so a failure partway through still
// leaves the most-recently-filled gap as far back as possible.
const backfillRecords = async (startDate: Date, endDate: Date) => {
  const start = moment(startDate).startOf("day");
  const end = moment(endDate).startOf("day");

  JobLogger.info(
    `Starting backfill from ${start.format("YYYY-MM-DD")} to ${end.format(
      "YYYY-MM-DD"
    )}...`
  );

  for (const day = start.clone(); !day.isAfter(end); day.add(1, "day")) {
    await writeRecordsForDay(day.toDate(), day.format(DateTimeFormat));
  }

  JobLogger.info("Backfill successfully executed...");
};

export default backfillRecords;
