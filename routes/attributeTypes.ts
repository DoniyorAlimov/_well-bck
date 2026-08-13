import express from "express";
import { reconcileAssetAttributesForUtilityTypes } from "../lib/attributeReconciliation";
import { requireAdmin } from "../middlewares/requireAdmin";
import { exportToExcel, importFromExcel } from "../misc/excel/attributeTypes";
import { prisma } from "../prisma/client";
import { attributeTypeSchema } from "../schemas";
import { upload } from "../storage";

const router = express.Router();

router.get("/", async (req, res) => {
  const types = await prisma.attributeType.findMany({
    include: { utilityType: true },
    orderBy: { id: "asc" },
  });

  res.send(types);
});

// GET the attribute type catalog as an Excel workbook
router.get("/exportToExcel", (req, res) => {
  exportToExcel(req, res);
});

// POST a bulk create/rename/delete of attribute types, and their owning
// asset type, from an Excel workbook
router.post("/importFromExcel", requireAdmin, upload.single("excelFile"), (req, res) => {
  importFromExcel(req, res);
});

router.post("/", async (req, res) => {
  const validation = attributeTypeSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).send(validation.error.format());

  const { name, description, unitId, utilityTypeId } = validation.data;

  const sameName = await prisma.attributeType.findUnique({
    where: { name_utilityTypeId: { name, utilityTypeId } },
  });
  if (sameName)
    return res.status(400).send({ message: "This asset type already has an attribute type with this name." });

  const created = await prisma.$transaction(async (tx) => {
    const attributeType = await tx.attributeType.create({
      data: { name, description, unitId: unitId ?? null, utilityTypeId },
      include: { utilityType: true },
    });

    await reconcileAssetAttributesForUtilityTypes(tx, [utilityTypeId]);

    return attributeType;
  });

  res.status(201).send(created);
});

router.put("/:id", async (req, res) => {
  const id = parseInt(req.params.id);

  const attributeType = await prisma.attributeType.findUnique({ where: { id } });
  if (!attributeType)
    return res.status(404).send({ message: "The attribute type with the given ID was not found." });

  const validation = attributeTypeSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).send(validation.error.format());

  const { name, description, unitId, utilityTypeId } = validation.data;

  const sameName = await prisma.attributeType.findUnique({
    where: { name_utilityTypeId: { name, utilityTypeId } },
  });
  if (sameName && sameName.id !== id)
    return res.status(400).send({ message: "This asset type already has an attribute type with this name." });

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.attributeType.update({
      where: { id },
      data: { name, description, unitId: unitId ?? null, utilityTypeId },
      include: { utilityType: true },
    });

    await reconcileAssetAttributesForUtilityTypes(tx, [attributeType.utilityTypeId, utilityTypeId]);

    return result;
  });

  res.send(updated);
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);

  const attributeType = await prisma.attributeType.findUnique({
    where: { id },
    include: { attributes: { select: { _count: { select: { assignments: true } } } } },
  });
  if (!attributeType)
    return res.status(404).send({ message: "The attribute type with the given ID was not found." });

  const assignmentCount = attributeType.attributes.reduce((sum, a) => sum + a._count.assignments, 0);
  if (assignmentCount)
    return res.status(400).send({
      message: `There are ${assignmentCount} PHD tag assignment(s) on this attribute type. Please remove them first.`,
    });

  await prisma.$transaction(async (tx) => {
    // The AttributeType <- Attribute relation has no onDelete: Cascade, so
    // any leftover Attribute instances must be cleared explicitly first.
    // Safe: we already confirmed above that none of them have a live
    // Assignment.
    await tx.attribute.deleteMany({ where: { attributeTypeId: id } });
    await tx.attributeType.delete({ where: { id } });
    await reconcileAssetAttributesForUtilityTypes(tx, [attributeType.utilityTypeId]);
  });

  res.send(attributeType);
});

export default router;
