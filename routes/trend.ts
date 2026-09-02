import express, { Request, Response } from "express";
import _ from "lodash";
import moment from "moment";
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

// GET /trend?assetId=&start=&end=&sampleIntervalMs=&tagIds=1,2,3
//
// Queries PHD directly for the given asset's assigned tags, batching every
// requested tag into a single POST /GetData call (see getBatchRawData in
// services/api-client.ts) rather than one call per tag — mirroring the
// pattern already used by the nightly sync job.
//
// sampleIntervalMs selects PHD's "Interpolated" mode (one value per that
// interval across the whole range, computed server-side in one call);
// omitting it requests RawData=true (actual stored samples, no
// resampling).
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

  if (tags.length === 0) {
    return res.send({ assetId: asset.id, assetName: asset.name, tags: [] });
  }

  let batchResults: Awaited<ReturnType<typeof getBatchRawData>> = [];
  try {
    batchResults = await getBatchRawData(
      tags.map((tag) => tag.tagName),
      moment(startDate).format(DateTimeFormat),
      moment(endDate).format(DateTimeFormat),
      interval
    );
  } catch (error) {
    console.error("Failed to fetch batch trend data from PHD", error);
    return res.status(502).send({ message: "Failed to fetch data from PHD" });
  }

  const byTagName = _.keyBy(batchResults, (r) => r.TagName);

  const responseTags = tags.map((tag) => {
    const result = byTagName[tag.tagName];

    // PHD's OutputTimeFormat=2 timestamps carry no timezone info — parsed
    // here as this process's own ambient local time, same as the rest of
    // this app (see helperFunctions.ts's getPreviousDayTime). Correct as
    // long as the server this runs on is configured in the historian's
    // timezone, which every other PHD interaction in this codebase already
    // assumes too.
    const points: TagPoint[] = (result?.TimeStamp ?? []).map((ts, i) => ({
      timestamp: moment(ts).toISOString(),
      value: result?.Value[i] ?? null,
    }));

    return {
      tagId: tag.tagId,
      tagName: tag.tagName,
      attributeId: tag.attributeId,
      attributeName: tag.attributeName,
      unit: result?.Units ?? tag.unit,
      points,
    };
  });

  res.send({ assetId: asset.id, assetName: asset.name, tags: responseTags });
});

export default router;
