import express, { Request, Response } from "express";
import moment from "moment";
import { JobLogger } from "../misc/logger";
import { backfillSchema } from "../schemas";
import backfillRecords from "../utils/PHDAPI/backfillRecords";

const router = express.Router();

// Safety cap on how many days one request can queue up — a full-tag-list
// fetch takes real time per day (see getBatchedRecords.ts), so an
// unbounded range could tie the job up for hours.
const MAX_BACKFILL_DAYS = 90;

// Backfilling more than a handful of days against the full PHD tag list can
// take minutes, far past any reasonable HTTP timeout. So this kicks the job
// off in the background and responds as soon as it starts, the same way
// the nightly job runs unattended; progress and failures land in the job
// log instead of the response.
router.post("/", async (req: Request, res: Response) => {
  const validation = backfillSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).send(validation.error.format());

  const { startDate, endDate } = validation.data;

  const start = moment(startDate).startOf("day");
  // The nightly job only ever writes a day once it's fully elapsed, so
  // backfill can't do any better than "yesterday" either — clamp instead
  // of rejecting outright, since "give me everything up to today" is a
  // reasonable thing to ask for.
  const yesterday = moment().subtract(1, "day").startOf("day");
  const requestedEnd = moment(endDate).startOf("day");
  const end = requestedEnd.isAfter(yesterday) ? yesterday : requestedEnd;

  if (end.isBefore(start)) {
    return res.status(400).send({
      message:
        "The selected range doesn't include any completed days yet — today's data isn't final.",
    });
  }

  const dayCount = end.diff(start, "days") + 1;
  if (dayCount > MAX_BACKFILL_DAYS) {
    return res.status(400).send({
      message: `Select at most ${MAX_BACKFILL_DAYS} days at a time.`,
    });
  }

  backfillRecords(start.toDate(), end.toDate()).catch((error) => {
    JobLogger.error("Backfill job failed: ", error);
  });

  res.status(202).send({
    message: `Backfill started for ${start.format("YYYY-MM-DD")} to ${end.format(
      "YYYY-MM-DD"
    )} (${dayCount} day(s)).`,
  });
});

export default router;
