import express from "express";
import { prisma } from "../prisma/client";
import { assignmentSchema, updateAssignmentSchema } from "../schemas";
import { Assignment } from "@prisma/client";

const router = express.Router();

router.get("/:attrId", async (req, res) => {
  const { attrId } = req.params;

  const assignments = await prisma.assignment.findMany({
    where: {
      attributeId: parseInt(attrId),
    },
    include: { PHDTag: true },
  });

  res.send(assignments);
});

router.post("/", async (req, res) => {
  const validation = assignmentSchema.safeParse(req.body);
  if (!validation.success)
    return res.status(400).send(validation.error.format());

  const { attributeId, PHDTagId } = req.body as Assignment;

  const existingAssignment = await prisma.assignment.findUnique({
    where: {
      attributeId_PHDTagId: { attributeId, PHDTagId },
    },
  });

  if (existingAssignment)
    return res
      .status(400)
      .send({ message: "The assignment is already exists" });

  const newAssignment = await prisma.assignment.create({
    data: {
      attributeId,
      PHDTagId,
    },
  });

  res.status(201).send(newAssignment);
});

router.put("/:attrId/:tagId", async (req, res) => {
  const { attrId, tagId } = req.params;
  const attributeId = parseInt(attrId);
  const tag = parseInt(tagId);

  const assignment = await prisma.assignment.findUnique({
    where: {
      attributeId_PHDTagId: {
        attributeId,
        PHDTagId: tag,
      },
    },
  });

  if (!assignment)
    return res
      .status(404)
      .send("The assignment with the given parameters was not found");

  const validation = updateAssignmentSchema.safeParse(req.body);
  if (!validation.success)
    return res.status(400).send(validation.error.format());

  const { PHDTagId } = req.body as Assignment;

  const existingAssignment = await prisma.assignment.findUnique({
    where: {
      attributeId_PHDTagId: {
        attributeId,
        PHDTagId,
      },
    },
  });

  if (existingAssignment)
    return res
      .status(400)
      .send("The assignment with the given tag already exists");

  const updatedAssignment = await prisma.assignment.update({
    where: {
      attributeId_PHDTagId: {
        attributeId,
        PHDTagId: tag,
      },
    },
    data: {
      PHDTagId,
    },
  });

  res.send(updatedAssignment);
});

router.delete("/:attrId/:tagId", async (req, res) => {
  const { attrId, tagId } = req.params;
  const attributeId = parseInt(attrId);
  const tag = parseInt(tagId);

  const assignment = await prisma.assignment.findUnique({
    where: {
      attributeId_PHDTagId: {
        attributeId,
        PHDTagId: tag,
      },
    },
  });

  if (!assignment)
    return res
      .status(404)
      .send("The assignment with the given parameters was not found");

  await prisma.assignment.delete({
    where: {
      attributeId_PHDTagId: {
        attributeId,
        PHDTagId: tag,
      },
    },
  });

  res.send(assignment);
});

export default router;
