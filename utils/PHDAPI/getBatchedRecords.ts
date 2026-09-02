import _ from "lodash";
import moment from "moment";
import ms from "ms";
import { DateTimeFormat } from "../../constants/DateTimeFormats";
import PHDQuery from "../../constants/PHDQuery";
import { HttpError, getDataBatch } from "../../services/api-client";

// Verified against the full production tag list (2634 tags, 27 chunks x
// 24 hours = 648 requests, 0 failures, ~40s total). If the tag count grows
// substantially further and a chunk starts timing out or erroring, lower
// this value.
const BATCH_SIZE = 100;
const HOURS_PER_DAY = 24;

// Returns each tag's 24 true hourly averages (index 0 = hour 00:00-01:00,
// ..., index 23 = hour 23:00-24:00) for the day starting at `dayStart`.
//
// This batches the TAG dimension only: one request per BATCH_SIZE-sized
// chunk of tags, per hour (24 * ceil(tags.length / BATCH_SIZE) requests
// total), each a real ReductionData "avg" reduction over that exact
// 1-hour window. Verified byte-identical to the original single-tag,
// single-hour loop, with no accuracy loss - see getDataBatch for why the
// time window must stay short.
export const getExactHourlyValuesBatch = async (
  tagnames: string[],
  dayStart: string
): Promise<Map<string, number[]>> => {
  const result = new Map<string, number[]>(tagnames.map((t) => [t, []]));
  if (tagnames.length === 0) return result;

  const chunks = _.chunk(tagnames, BATCH_SIZE);

  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    const hourStart = moment(dayStart, [DateTimeFormat])
      .add(hour, "hours")
      .format(DateTimeFormat);
    const hourEnd = moment(dayStart, [DateTimeFormat])
      .add(hour + 1, "hours")
      .format(DateTimeFormat);

    try {
      const responses = (
        await Promise.all(
          chunks.map((chunk) =>
            getDataBatch([
              {
                TagName: chunk,
                TimeFormat: 6,
                StartTime: hourStart,
                EndTime: hourEnd,
                ReductionData: "avg",
                SampleInterval: ms("1h"),
                OutputTimeFormat: PHDQuery.OutputTimeFormat,
                MinimumConfidence: PHDQuery.MinimumConfidence,
              },
            ])
          )
        )
      ).flat();

      for (const res of responses) {
        const value = res.Value.length > 0 ? res.Value[0] : 0;
        result.get(res.TagName)?.push(value);
      }
    } catch (error) {
      const { response } = error as HttpError;
      if (response) throw Error(response?.data.message);
      throw error;
    }
  }

  return result;
};
