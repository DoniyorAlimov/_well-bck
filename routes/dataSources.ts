import { DataSource } from "@prisma/client";
import express from "express";
import { prisma } from "../prisma/client";
import { dataSourceSchema } from "../schemas";

const router = express.Router();

router.get("/:id", async (req, res) => {
  const dataSource = await prisma.dataSource.findUnique({
    where: { id: parseInt(req.params.id) },
  });

  if (!dataSource)
    return res
      .status(404)
      .send({ message: "The data source with the given ID was not found." });

  res.send(dataSource);
});

router.put("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const dataSource = await prisma.dataSource.findUnique({
    where: { id },
  });

  if (!dataSource)
    return res
      .status(404)
      .send({ message: "The data source with the given ID was not found." });

  const validation = dataSourceSchema.safeParse(req.body);
  if (!validation.success)
    return res.status(400).send(validation.error.format());

  const { host, port } = req.body as DataSource;

  const updatedDataSource = await prisma.dataSource.update({
    where: { id },
    data: { host, port },
  });

  res.status(200).send(updatedDataSource);
});

export default router;
