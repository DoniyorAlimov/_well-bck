import express, { Request, Response } from 'express';
import { prisma } from '../prisma/client';
import { requireAdmin } from '../middlewares/requireAdmin';
import { createAssetWithAttributes } from '../lib/assetHelpers';
import { upload } from '../storage';
import { exportToExcel, importFromExcel } from '../misc/excel/assets';

const router = express.Router();

// GET all assets, including their utility type.
// The frontend will be responsible for building the tree structure.
router.get('/', async (req, res) => {
  try {
    const assets = await prisma.asset.findMany({
      include: {
        utilityType: true,
        attributes: {
          include: {
            assignments: {
              include: {
                PHDTag: true
              }
            }
          }
        }
      },
      orderBy: {
        name: 'asc',
      },
    });
    res.json(assets);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch assets' });
  }
});

// GET tags for autocomplete
router.get('/tags', async (req: Request, res: Response) => {
  const { q } = req.query;
  try {
    const where = q ? { tagname: { contains: String(q) } } : {};
    const tags = await prisma.pHDTag.findMany({
      where,
      take: 50,
      orderBy: { tagname: 'asc' }
    });
    res.json(tags);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch tags' });
  }
});

// GET the asset tree as an Excel workbook
router.get('/exportToExcel', (req, res) => {
  exportToExcel(req, res);
});

// POST a bulk create/rename/delete of assets from an Excel workbook
router.post('/importFromExcel', requireAdmin, upload.single('excelFile'), (req, res) => {
  importFromExcel(req, res);
});

// GET a single asset by ID
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const assetId = parseInt(id, 10);
  if (isNaN(assetId)) {
    return res.status(400).json({ message: 'Invalid asset ID' });
  }
  try {
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
      include: {
        utilityType: true,
        attributes: {
          include: {
            assignments: {
              include: {
                PHDTag: { include: { unit: true } },
              },
            },
          },
        },
      },
    });

    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }
    res.json(asset);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch asset' });
  }
});

// POST create/update assignment
router.post('/assign', async (req: Request, res: Response) => {
  const { attributeId, tagName } = req.body;

  try {
    // 1. Find the tag
    const tag = await prisma.pHDTag.findFirst({ where: { tagname: tagName } });
    if (!tag) {
       return res.status(404).json({ message: 'Tag not found' });
    }

    // 2. Clear old assignments for this attribute (enforce 1:1 for now)
    await prisma.assignment.deleteMany({ where: { attributeId: attributeId } });

    // 3. Create new assignment
    const assignment = await prisma.assignment.create({
      data: { attributeId, PHDTagId: tag.id }
    });

    res.json(assignment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to assign tag' });
  }
});

// POST a new asset
router.post('/', requireAdmin, async (req: Request, res: Response) => {
  const { name, parentAssetId, utilityTypeId } = req.body;

  if (!name || !utilityTypeId) {
    return res.status(400).json({ message: '`name` and `utilityTypeId` are required.' });
  }

  try {
    const utilityType = await prisma.utilityType.findUnique({
      where: { id: parseInt(utilityTypeId, 10) },
    });

    if (!utilityType) {
      return res.status(400).json({ message: `UtilityType '${utilityTypeId}' not found.` });
    }

    const newAsset = await createAssetWithAttributes(prisma, {
      name,
      parentAssetId: parentAssetId ? parseInt(parentAssetId, 10) : null,
      utilityTypeId: utilityType.id,
    });

    res.status(201).json(newAsset);
  } catch (error: any) {
    console.error(error);
    if (error.code === 'P2002' && error.meta?.target?.includes('name')) {
      return res.status(409).json({ message: `An asset with the name '${name}' already exists.` });
    }
    res.status(500).json({ message: 'Failed to create asset' });
  }
});

// PUT update an asset
router.put('/:id', requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const assetId = parseInt(id, 10);

  if (isNaN(assetId)) {
    return res.status(400).json({ message: 'Invalid asset ID' });
  }

  const { name, parentAssetId, utilityTypeId } = req.body;

  if (!name) {
    return res.status(400).json({ message: '`name` is required.' });
  }

  try {
    const existing = await prisma.asset.findUnique({ where: { id: assetId } });
    if (!existing) return res.status(404).json({ message: 'Asset not found' });

    const updatedAsset = await prisma.asset.update({
      where: { id: assetId },
      data: {
        name,
        ...(parentAssetId !== undefined && {
          parentAssetId: parentAssetId === null ? null : parseInt(parentAssetId, 10),
        }),
        ...(utilityTypeId !== undefined && { utilityTypeId: parseInt(utilityTypeId, 10) }),
      },
    });

    res.json(updatedAsset);
  } catch (error: any) {
    console.error(error);
    if (error.code === 'P2002' && error.meta?.target?.includes('name')) {
      return res.status(409).json({ message: `An asset with the name '${name}' already exists.` });
    }
    res.status(500).json({ message: 'Failed to update asset' });
  }
});

// DELETE an asset
router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const assetId = parseInt(id, 10);

  if (isNaN(assetId)) {
    return res.status(400).json({ message: 'Invalid asset ID' });
  }

  try {
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) return res.status(404).json({ message: 'Asset not found' });

    // parentAsset uses onDelete: NoAction, so the DB rejects deleting a
    // parent while children still reference it — check first so callers get
    // a clear message instead of a raw foreign-key-constraint 500.
    const childCount = await prisma.asset.count({ where: { parentAssetId: assetId } });
    if (childCount > 0) {
      return res.status(409).json({
        message: `This asset has ${childCount} child asset(s). Delete them first.`,
      });
    }

    await prisma.asset.delete({ where: { id: assetId } });
    res.json(asset);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to delete asset' });
  }
});

export default router;