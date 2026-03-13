import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import auth from '../middlewares/auth';
import admin from '../middlewares/admin';

const prisma = new PrismaClient();
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
    res.status(500).json({ error: 'Failed to fetch assets' });
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
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

// GET a single asset by ID
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const assetId = parseInt(id, 10);
  if (isNaN(assetId)) {
    return res.status(400).json({ error: 'Invalid asset ID' });
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
                PHDTag: true,
              },
            },
          },
        },
      },
    });

    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }
    res.json(asset);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch asset' });
  }
});

// POST create/update assignment
router.post('/assign', async (req: Request, res: Response) => {
  const { attributeId, tagName } = req.body;

  try {
    // 1. Find the tag
    const tag = await prisma.pHDTag.findFirst({ where: { tagname: tagName } });
    if (!tag) {
       return res.status(404).json({ error: 'Tag not found' });
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
    res.status(500).json({ error: 'Failed to assign tag' });
  }
});

// POST a new asset
router.post('/', [auth, admin], async (req: Request, res: Response) => {
  const { name, parentAssetId, utilityTypeName } = req.body;

  // Default to 'Field' if utilityTypeName is missing
  const effectiveUtilityTypeName = utilityTypeName || 'Field';

  if (!name || !effectiveUtilityTypeName) {
    return res.status(400).json({ error: '`name` and `utilityTypeName` are required.' });
  }

  try {
    const utilityType = await prisma.utilityType.findUnique({
      where: { name: effectiveUtilityTypeName },
    });

    if (!utilityType) {
      return res.status(400).json({ error: `UtilityType '${effectiveUtilityTypeName}' not found.` });
    }

    const attributeTypes = await prisma.attributeType.findMany();

    const newAsset = await prisma.asset.create({
      data: {
        name,
        parentAssetId: parentAssetId ? parseInt(parentAssetId, 10) : null,
        utilityTypeId: utilityType.id,
        attributes: {
          create: attributeTypes.map((at) => ({
            name: at.name,
            attributeTypeId: at.id,
          })),
        },
      },
    });

    res.status(201).json(newAsset);
  } catch (error: any) {
    console.error(error);
    if (error.code === 'P2002' && error.meta?.target?.includes('name')) {
      return res.status(409).json({ error: `An asset with the name '${name}' already exists.` });
    }
    res.status(500).json({ error: 'Failed to create asset' });
  }
});

// DELETE an asset
router.delete('/:id', [auth, admin], async (req: Request, res: Response) => {
  const { id } = req.params;
  const assetId = parseInt(id, 10);

  if (isNaN(assetId)) {
    return res.status(400).json({ error: 'Invalid asset ID' });
  }

  try {
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    await prisma.asset.delete({ where: { id: assetId } });
    res.json(asset);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete asset' });
  }
});

export default router;