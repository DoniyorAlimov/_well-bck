import express, { Request, Response } from "express";
import _ from "lodash";
import moment from "moment";
import ms from "ms";
import { DateTimeFormat } from "../constants/DateTimeFormats";
import { prisma } from "../prisma/client";
import { getBatchRawData } from "../services/api-client";

const router = express.Router();

interface TagPoint {
  timestamp: string;
  value: number | null;
}

interface TagCandidate {
  tagId: number;
  tagName: string;
  attributeId: number;
  attributeName: string;
  unit: string;
}

interface ResponseTag extends TagCandidate {
  points: TagPoint[];
}

// PHD's own guidance (see services/api-client.ts's getBatchRawData comment)
// is that a batched call is fast up to a day-scale window but untested -
// treat with caution - beyond that. Chunking by time serves two purposes at
// once: it keeps every individual PHD call inside the range that's actually
// been verified safe, and it gives the frontend something to render before
// the whole [start, end] window has been fetched.
const CHUNK_TARGET_MS = ms("1d");
const MAX_CHUNKS = 24;

const buildTimeChunks = (start: Date, end: Date): { start: Date; end: Date }[] => {
  const totalMs = end.getTime() - start.getTime();
  const chunkMs = totalMs / CHUNK_TARGET_MS > MAX_CHUNKS ? Math.ceil(totalMs / MAX_CHUNKS) : CHUNK_TARGET_MS;

  const chunks: { start: Date; end: Date }[] = [];
  let chunkStart = start.getTime();
  while (chunkStart < end.getTime()) {
    const chunkEnd = Math.min(chunkStart + chunkMs, end.getTime());
    chunks.push({ start: new Date(chunkStart), end: new Date(chunkEnd) });
    chunkStart = chunkEnd;
  }
  return chunks;
};

const sendEvent = (res: Response, event: string, data: unknown) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

// How close chunkEnd has to be to the real current time for it to count as
// "the user asked for live data" rather than a specific historical instant
// that merely happens to be recent - covers the gap between the browser
// capturing `end = new Date()` and this chunk's PHD request actually going
// out (page load, asset lookup, prior chunks in the stream).
const NOW_TOLERANCE_MS = ms("5m");

// PHD's Interpolated (SampleInterval) mode grids forward from whatever
// StartTime it's given: StartTime, StartTime+interval, StartTime+2*interval,
// ... With chunkStart as StartTime, that grid's phase is whatever chunkStart
// happens to be - for the common case of "today" it's local midnight, so a
// 1h interval always lands on the hour (10:00, 11:00, ...) no matter how far
// through the current hour "now" actually is. Snapping the query's
// StartTime down to the nearest instant that's `interval` multiples away
// from gridPhase (the requested end/now) re-anchors the grid there instead,
// so points land at now, now-interval, now-2*interval, ... preserving now's
// sub-interval offset (e.g. now=11:25:23 -> ...,10:25:23, 11:25:23).
const alignDownToPhase = (timeMs: number, interval: number, phaseMs: number): number => {
  const remainder = (((timeMs - phaseMs) % interval) + interval) % interval;
  return timeMs - remainder;
};

const fetchChunkTags = async (
  tags: TagCandidate[],
  chunkStart: Date,
  chunkEnd: Date,
  interval: number | undefined,
  isLastChunk: boolean,
  isFirstChunk: boolean,
  gridPhase: number
): Promise<ResponseTag[]> => {
  let endTime: string;
  if (isLastChunk && Date.now() - chunkEnd.getTime() < NOW_TOLERANCE_MS) {
    // An absolute EndTime only ever gets PHD as far as the grid reaches -
    // PHD won't fabricate a point past the last full interval that lands at
    // or before EndTime. PHD's "NOW" keyword is instead resolved
    // dynamically against its own clock and does return a point at the
    // true current instant, so it's used here whenever the requested end is
    // effectively "now".
    endTime = "NOW";
  } else {
    // Chunks are built back-to-back (chunkEnd of one === chunkStart of the
    // next). PHD's EndTime is inclusive, so without this every boundary
    // instant would come back twice - once as the last point of one chunk,
    // once as the first point of the next.
    const trimmedEnd = isLastChunk ? chunkEnd : new Date(chunkEnd.getTime() - 1);
    endTime = moment(trimmedEnd).format(DateTimeFormat);
  }

  // Only re-anchor the grid for interpolated queries - raw data has no grid
  // to misalign, it's just whatever was actually stored.
  const queryStart = interval ? new Date(alignDownToPhase(chunkStart.getTime(), interval, gridPhase)) : chunkStart;

  const batchResults = await getBatchRawData(
    tags.map((tag) => tag.tagName),
    moment(queryStart).format(DateTimeFormat),
    endTime,
    interval
  );

  const byTagName = _.keyBy(batchResults, (r) => r.TagName);
  const chunkStartMs = chunkStart.getTime();

  return tags.map((tag) => {
    const result = byTagName[tag.tagName];

    // PHD's OutputTimeFormat=2 timestamps carry no timezone info - parsed
    // here as this process's own ambient local time, same as the rest of
    // this app (see helperFunctions.ts's getPreviousDayTime). Correct as
    // long as the server this runs on is configured in the historian's
    // timezone, which every other PHD interaction in this codebase already
    // assumes too.
    const points: TagPoint[] = (result?.TimeStamp ?? [])
      .map((ts, i) => ({ timestamp: moment(ts).toISOString(), value: result?.Value[i] ?? null, ms: moment(ts).valueOf() }))
      // queryStart was snapped earlier than chunkStart purely to fix the
      // grid's phase - trim the resulting pre-chunkStart point back off so
      // this chunk still only contributes its own [chunkStart, chunkEnd)
      // slice (the next-older chunk covers what comes before it), UNLESS
      // this is the oldest chunk overall, where that one earlier point is
      // exactly what's needed to reach the requested start instead of
      // leaving a gap between it and the grid's first on-phase point.
      .filter((p) => !interval || isFirstChunk || p.ms >= chunkStartMs)
      .map(({ timestamp, value }) => ({ timestamp, value }));

    return { ...tag, unit: result?.Units ?? tag.unit, points };
  });
};

// GET /trend?assetId=&start=&end=&sampleIntervalMs=&tagIds=1,2,3
//
// Streams the asset's trend data back over Server-Sent Events instead of
// waiting for the full [start, end] window to be ready: the range is split
// into chunks (see buildTimeChunks) that are fetched from PHD newest chunk
// first and pushed to the client as soon as each one lands, so a large time
// range draws in progressively - from the end date backward toward the
// start - instead of the chart staying blank until the very last (and
// slowest) request completes.
//
// Event stream shape:
//   event: meta   - { assetId, assetName, tags: [{tagId, tagName, attributeId, attributeName, unit}] }
//   event: chunk  - { chunkIndex, chunkCount, rangeStart, rangeEnd, tags: [{..., points}] } (repeated)
//   event: error  - { message } (terminal - no further events follow)
//   event: done   - {} (terminal)
router.get("/", async (req: Request, res: Response) => {
  const { assetId, start, end, sampleIntervalMs, tagIds } = req.query;

  if (!assetId || !start || !end) {
    return res.status(400).send({ message: "assetId, start and end are required" });
  }

  const startDate = new Date(start as string);
  const endDate = new Date(end as string);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || startDate >= endDate) {
    return res.status(400).send({ message: "Invalid start/end range" });
  }

  let interval: number | undefined;
  if (sampleIntervalMs) {
    interval = parseInt(sampleIntervalMs as string);
    if (isNaN(interval) || interval <= 0) {
      return res.status(400).send({ message: "Invalid sampleIntervalMs" });
    }
  }

  const asset = await prisma.asset.findUnique({
    where: { id: parseInt(assetId as string) },
    include: {
      attributes: {
        include: {
          assignments: {
            include: { PHDTag: { include: { unit: true } } },
          },
        },
      },
    },
  });

  if (!asset) return res.status(404).send({ message: "Asset not found" });

  const tagIdFilter = tagIds
    ? new Set((tagIds as string).split(",").map((id) => parseInt(id)))
    : null;

  const tags: TagCandidate[] = asset.attributes
    .map((attribute): TagCandidate | null => {
      const assignment = attribute.assignments[0];
      if (!assignment) return null;
      if (tagIdFilter && !tagIdFilter.has(assignment.PHDTag.id)) return null;

      return {
        tagId: assignment.PHDTag.id,
        tagName: assignment.PHDTag.tagname,
        attributeId: attribute.id,
        attributeName: attribute.name,
        unit: assignment.PHDTag.unit.name,
      };
    })
    .filter((tag): tag is TagCandidate => tag !== null);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let clientClosed = false;
  req.on("close", () => {
    clientClosed = true;
  });

  sendEvent(res, "meta", {
    assetId: asset.id,
    assetName: asset.name,
    tags: tags.map(({ tagId, tagName, attributeId, attributeName, unit }) => ({
      tagId,
      tagName,
      attributeId,
      attributeName,
      unit,
    })),
  });

  if (tags.length === 0) {
    sendEvent(res, "done", {});
    return res.end();
  }

  // Fetched newest-first (chronologically last chunk fetched first) so the
  // client can draw the line outward from the end date backward, rather
  // than from the start date forward.
  const chunks = buildTimeChunks(startDate, endDate).reverse();

  // The interpolation grid's phase (see alignDownToPhase) - anchored to the
  // requested end so every chunk's grid points share the same "now, now-1h,
  // now-2h, ..." offset instead of each independently drifting to whatever
  // its own chunkStart happens to be.
  const gridPhase = interval ? ((endDate.getTime() % interval) + interval) % interval : 0;

  for (let i = 0; i < chunks.length; i++) {
    if (clientClosed) return;

    const { start: chunkStart, end: chunkEnd } = chunks[i];
    // Boundary trimming (see fetchChunkTags) depends on chronological
    // position, not emission order - the chunk reaching the overall end
    // date is the one that must keep its inclusive endpoint, and the chunk
    // reaching the overall start date is the one allowed to keep its
    // grid-alignment point that lands before its own chunkStart.
    const isChronologicallyLastChunk = chunkEnd.getTime() >= endDate.getTime();
    const isChronologicallyFirstChunk = chunkStart.getTime() <= startDate.getTime();

    try {
      const responseTags = await fetchChunkTags(
        tags,
        chunkStart,
        chunkEnd,
        interval,
        isChronologicallyLastChunk,
        isChronologicallyFirstChunk,
        gridPhase
      );

      if (clientClosed) return;

      sendEvent(res, "chunk", {
        chunkIndex: i,
        chunkCount: chunks.length,
        rangeStart: chunkStart.toISOString(),
        rangeEnd: chunkEnd.toISOString(),
        tags: responseTags,
      });
    } catch (error) {
      console.error("Failed to fetch batch trend data from PHD", error);
      if (!clientClosed) sendEvent(res, "error", { message: "Failed to fetch data from PHD" });
      return res.end();
    }
  }

  sendEvent(res, "done", {});
  res.end();
});

export default router;
