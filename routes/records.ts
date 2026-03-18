import { Record } from "@prisma/client";
import express, { Request, Response } from "express";
import _ from "lodash";
import {
  RequestBody,
  RequestParams,
  ResponseBody,
} from "../entities/RequestQuery";
import { prisma } from "../prisma/client";

const router = express.Router();

// GET latest single record for Real-Time view
router.get("/latest", async (req: Request, res: Response) => {
  const { tagId } = req.query;
  if (!tagId) return res.status(400).send({ error: "tagId is required" });

  try {
    const record = await prisma.record.findFirst({
      where: { PHDTagId: parseInt(tagId as string) },
      orderBy: { timestamp: "desc" },
    });
    res.send(record);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch latest record" });
  }
});

// GET summary/aggregations for Min/Max/Avg and Aggregated views
router.get("/summary", async (req: Request, res: Response) => {
  const { tagId, start, end } = req.query;
  if (!tagId || !start || !end) return res.status(400).send({ error: "tagId, start, end are required" });

  try {
    const stats = await prisma.record.aggregate({
      where: {
        PHDTagId: parseInt(tagId as string),
        timestamp: {
          gte: start as string,
          lte: end as string,
        },
      },
      _min: { value: true },
      _max: { value: true },
      _avg: { value: true },
      _sum: { value: true },
    });
    
    res.send(stats);
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "Failed to fetch summary" });
  }
});

// Existing GET / handler
interface RecordQuery {
  PHDTagIds?: string[];
  tagId?: string;
  start?: string;
  end?: string;
}

router.get(
  "/",
  async (
    req: Request<RequestParams, ResponseBody, RequestBody, RecordQuery>,
    res: Response
  ) => {
    const { PHDTagIds, tagId, start, end } = req.query;

    // If the frontend is requesting trend data for a specific tag
    if (tagId && start && end) {
      const records = await prisma.record.findMany({
        where: {
          PHDTagId: parseInt(tagId as string),
          timestamp: {
            gte: start as string,
            lte: end as string,
          },
        },
        orderBy: { timestamp: "asc" },
      });
      return res.send(records);
    }

    if (!PHDTagIds) {
      const records = await prisma.record.findMany();
      return res.send(records);
    }

    let records: Record[] = [];

    for (let id of PHDTagIds) {
      const record = await prisma.record.findMany({
        where: {
          PHDTagId: parseInt(id),
        },
        include: { PHDTag: { include: { unit: true } } },
      });
      records = _.concat(records, record);
    }

    res.send(records);
  }
);

export default router;
