import { Prisma } from "@prisma/client";

// Every asset gets one Attribute instance per AttributeType owned by its
// UtilityType. Shared by the single-asset POST /assets route and the bulk
// Excel importer so the two paths can't drift.
export const createAssetWithAttributes = async (
  tx: Prisma.TransactionClient,
  data: { name: string; parentAssetId: number | null; utilityTypeId: number }
) => {
  const attributeTypes = await tx.attributeType.findMany({
    where: { utilityTypeId: data.utilityTypeId },
  });

  return tx.asset.create({
    data: {
      name: data.name,
      parentAssetId: data.parentAssetId,
      utilityTypeId: data.utilityTypeId,
      attributes: {
        create: attributeTypes.map((at) => ({
          name: at.name,
          attributeTypeId: at.id,
        })),
      },
    },
  });
};
