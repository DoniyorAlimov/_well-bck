import express, { Request, Response } from "express";
import {
  RequestBody,
  RequestParams,
  RequestQuery,
  ResponseBody,
} from "../entities/RequestQuery";
import { exportToExcel, importFromExcel } from "../misc/excel/PHDTags";
import { prisma } from "../prisma/client";
import { phdTagSchema } from "../schemas";
import { upload } from "../storage";
import { PHDTag } from "@prisma/client";

const router = express.Router();

router.get(
  "/",
  async (
    req: Request<RequestParams, ResponseBody, RequestBody, RequestQuery>,
    res: Response
  ) => {
    const { page, pageSize, searchedName } = req.query;

    const where = {
      tagname: {
        contains: searchedName,
      },
    };

    const include = {
      unit: true,
    };

    const orderBy = { tagname: "asc" } as const;

    const count = (await prisma.pHDTag.findMany({ where })).length;

    const tags =
      page && pageSize
        ? await prisma.pHDTag.findMany({
            where,
            orderBy,
            include,
            skip: (parseInt(page) - 1) * parseInt(pageSize),
            take: parseInt(pageSize),
          })
        : await prisma.pHDTag.findMany({
            orderBy,
            where,
            include,
          });

    res.send({
      count,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      results: tags,
    });
  }
);

router.get("/exportToExcel", (req, res) => {
  exportToExcel(req, res);
});

router.get("/:id", async (req, res) => {
  const tag = await prisma.pHDTag.findUnique({
    where: { id: parseInt(req.params.id) },
  });
  if (!tag)
    return res
      .status(404)
      .send({ message: "The PHD tag with the given ID was not found." });

  res.send(tag);
});

router.post("/", async (req, res) => {
  const validation = phdTagSchema.safeParse(req.body);
  if (!validation.success)
    return res.status(400).send(validation.error.format());

  const { tagname, unitId } = req.body as PHDTag;

  const sameTagname = await prisma.pHDTag.findUnique({
    where: { tagname },
  });

  if (sameTagname)
    return res
      .status(400)
      .send({ message: "The PHD tag with this tagname is already exists." });

  const newTag = await prisma.pHDTag.create({
    data: {
      tagname,
      unitId,
    },
  });

  res.status(201).send(newTag);
});

router.post(
  "/importFromExcel",
  upload.single("excelFile"),
  (req, res) => {
    importFromExcel(req, res);
  }
);

router.put("/:id", async (req, res) => {
  const id = parseInt(req.params.id);

  const tag = await prisma.pHDTag.findUnique({
    where: { id: parseInt(req.params.id) },
  });
  if (!tag)
    return res
      .status(404)
      .send({ message: "The PHD tag with the given ID was not found." });

  const validation = phdTagSchema.safeParse(req.body);
  if (!validation.success)
    return res.status(400).send(validation.error.format());

  const { tagname, unitId } = req.body as PHDTag;

  const sameTagname = await prisma.pHDTag.findUnique({
    where: { tagname },
  });

  if (sameTagname && sameTagname.id !== id)
    return res
      .status(400)
      .send({ message: "The PHD tag with this tagname is already exists." });

  const updatedTag = await prisma.pHDTag.update({
    where: { id },
    data: {
      tagname,
      unitId,
    },
  });

  res.status(200).send(updatedTag);
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);

  const tag = await prisma.pHDTag.findUnique({
    where: { id },
    include: { assignments: true },
  });
  if (!tag)
    return res
      .status(404)
      .send({ message: "The PHD tag with the given ID was not found." });

  if (tag.assignments.length)
    return res
      .status(500)
      .send({ message: "The tag has one or more assignments" });

  await prisma.pHDTag.delete({ where: { id } });

  res.send(tag);
});

export default router;
