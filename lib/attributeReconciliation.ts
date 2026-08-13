import { Prisma } from "@prisma/client";

// Brings every existing asset of a given UtilityType back in line with the
// AttributeTypes currently owned by that type: drops Attribute rows for
// AttributeTypes that no longer belong to the asset's type (cascades to
// their Assignments, same as the unguarded DELETE /attributes/:id route),
// and adds Attribute rows for newly-added AttributeTypes the asset doesn't
// have yet. Called whenever an AttributeType is created, moved to a
// different asset type, or deleted.
export const reconcileAssetAttributesForUtilityType = async (
  tx: Prisma.TransactionClient,
  utilityTypeId: number
) => {
  const [attributeTypes, assets] = await Promise.all([
    tx.attributeType.findMany({ where: { utilityTypeId } }),
    tx.asset.findMany({
      where: { utilityTypeId },
      include: { attributes: true },
    }),
  ]);

  const ownedIds = new Set(attributeTypes.map((at) => at.id));
  const nameByAttributeTypeId = new Map(attributeTypes.map((at) => [at.id, at.name]));

  for (const asset of assets) {
    const existingIds = new Set(asset.attributes.map((a) => a.attributeTypeId));

    const toRemoveIds = asset.attributes
      .filter((a) => !ownedIds.has(a.attributeTypeId))
      .map((a) => a.id);
    if (toRemoveIds.length) {
      await tx.attribute.deleteMany({ where: { id: { in: toRemoveIds } } });
    }

    const toCreateAttributeTypeIds = [...ownedIds].filter((id) => !existingIds.has(id));
    if (toCreateAttributeTypeIds.length) {
      await tx.attribute.createMany({
        data: toCreateAttributeTypeIds.map((attributeTypeId) => ({
          name: nameByAttributeTypeId.get(attributeTypeId)!,
          assetId: asset.id,
          attributeTypeId,
        })),
      });
    }
  }
};

export const reconcileAssetAttributesForUtilityTypes = async (
  tx: Prisma.TransactionClient,
  utilityTypeIds: Iterable<number>
) => {
  for (const utilityTypeId of new Set(utilityTypeIds)) {
    await reconcileAssetAttributesForUtilityType(tx, utilityTypeId);
  }
};
