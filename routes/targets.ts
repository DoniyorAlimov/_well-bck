import express, { Request, Response } from "express";
import {
  RequestBody,
  RequestParams,
  RequestQuery,
  ResponseBody,
} from "../entities/RequestQuery";
import { prisma } from "../prisma/client";
import { targetSchema, updateTargetSchema } from "../schemas";
import { Target } from "@prisma/client";

const router = express.Router();

interface TargetQuery extends RequestQuery {
  assetId: string;
}

router.get(
  "/",
  async (
    req: Request<RequestParams, ResponseBody, RequestBody, TargetQuery>,
    res: Response
  ) => {
    const { assetId } = req.query as TargetQuery;

    if (assetId) {
      const target = await prisma.target.findUnique({
        where: { assetId: parseInt(assetId) },
      });
      if (!target)
        return res.status(404).send({ message: "The targets were not found." });
      return res.send(target);
    }
  }
);

router.post("/", async (req, res) => {
  const validation = targetSchema.safeParse(req.body);
  if (!validation.success)
    return res.status(400).send(validation.error.format());

  const {
    productionTarget,
    energyConsumptionTarget,
    specificEnergyConsupmtionTarget,
    CO2EmissionTarget,
    assetId,
  } = req.body as Target;

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
  });
  if (!asset)
    return res
      .status(404)
      .send({ message: "The invalid asset ID was provided." });

  const target = await prisma.target.findUnique({
    where: { assetId },
  });
  if (target)
    return res
      .status(400)
      .send({ message: "The targets for this asset are already set" });

  const newTarget = await prisma.target.create({
    data: {
      productionTarget,
      energyConsumptionTarget,
      specificEnergyConsupmtionTarget,
      CO2EmissionTarget,
      assetId,
    },
  });

  res.status(201).send(newTarget);
});

router.put("/:id", async (req, res) => {
  const id = parseInt(req.params.id);

  const target = await prisma.target.findUnique({
    where: { id },
  });
  if (!target)
    return res.status(404).send({ message: "The target was not found." });

  const validation = updateTargetSchema.safeParse(req.body);
  if (!validation.success)
    return res.status(400).send(validation.error.format());

  const {
    productionTarget,
    energyConsumptionTarget,
    specificEnergyConsupmtionTarget,
    CO2EmissionTarget,
  } = req.body as Target;

  const updatedTarget = await prisma.target.update({
    where: { id },
    data: {
      productionTarget,
      energyConsumptionTarget,
      specificEnergyConsupmtionTarget,
      CO2EmissionTarget,
    },
  });

  res.send(updatedTarget);
});

export default router;
