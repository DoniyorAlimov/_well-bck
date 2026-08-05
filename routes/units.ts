import { Unit } from "@prisma/client";
import express, { Request, Response } from "express";
import {
  RequestBody,
  RequestParams,
  RequestQuery,
  ResponseBody,
} from "../entities/RequestQuery";
import { prisma } from "../prisma/client";
import { unitSchema } from "../schemas";

const router = express.Router();

router.get(
  "/",
  async (
    req: Request<RequestParams, ResponseBody, RequestBody, RequestQuery>,
    res: Response
  ) => {
    const { page, pageSize, searchedName } = req.query;

    const where = {
      name: {
        contains: searchedName,
      },
    };

    const orderBy = { name: "asc" } as const;

    const count = (await prisma.unit.findMany({ where })).length;

    const units =
      page && pageSize
        ? await prisma.unit.findMany({
            where,
            orderBy,
            skip: (parseInt(page) - 1) * parseInt(pageSize),
            take: parseInt(pageSize),
          })
        : await prisma.unit.findMany({
            orderBy,
            where,
          });

    res.send({
      count,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      results: units,
    });
  }
);

router.get("/:id", async (req, res) => {
  const unit = await prisma.unit.findUnique({
    where: { id: parseInt(req.params.id) },
  });
  if (!unit)
    return res
      .status(404)
      .send({ message: "The unit with the given ID was not found." });

  res.send(unit);
});

router.post("/", async (req, res) => {
  const validation = unitSchema.safeParse(req.body);
  if (!validation.success)
    return res.status(400).send(validation.error.format());

  const { name } = req.body as Unit;

  const sameUnit = await prisma.unit.findUnique({
    where: { name },
  });

  if (sameUnit)
    return res
      .status(400)
      .send({ message: "The unit with this name is already exists." });

  const newUnit = await prisma.unit.create({
    data: {
      name,
    },
  });

  res.status(201).send(newUnit);
});

router.put("/:id", async (req, res) => {
  const id = parseInt(req.params.id);

  const unit = await prisma.unit.findUnique({
    where: { id },
  });
  if (!unit)
    return res
      .status(404)
      .send({ message: "The unit with the given ID was not found." });

  const validation = unitSchema.safeParse(req.body);
  if (!validation.success)
    return res.status(400).send(validation.error.format());

  const { name } = req.body as Unit;

  const sameUnit = await prisma.unit.findUnique({
    where: { name },
  });

  if (sameUnit && sameUnit.id !== id)
    return res
      .status(400)
      .send({ message: "The unit with this tagname is already exists." });

  const updatedUnit = await prisma.unit.update({
    where: { id },
    data: {
      name,
    },
  });

  res.status(200).send(updatedUnit);
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);

  const unit = await prisma.unit.findUnique({
    where: { id },
    include: { PHDTags: true },
  });
  if (!unit)
    return res
      .status(404)
      .send({ message: "The unit with the given ID was not found." });

  if (unit.PHDTags.length)
    return res.status(500).send({
      message:
        "There are assignments to the units. Please delete according assigned tags",
    });

  await prisma.unit.delete({ where: { id } });

  res.send(unit);
});

export default router;
