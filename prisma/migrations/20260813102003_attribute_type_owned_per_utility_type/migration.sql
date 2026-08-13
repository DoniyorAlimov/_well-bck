BEGIN TRY

BEGIN TRAN;

-- AlterTable: utilityTypeId is now populated for every AttributeType row
-- (backfilled by a data migration script run before this migration), so it
-- can safely become required.
ALTER TABLE [dbo].[AttributeType] ALTER COLUMN [utilityTypeId] INT NOT NULL;

-- AddUniqueConstraint: each asset type now owns its own attribute
-- definitions, so uniqueness moves from `name` alone to `(name, utilityTypeId)`.
ALTER TABLE [dbo].[AttributeType] ADD CONSTRAINT [AttributeType_name_utilityTypeId_key] UNIQUE NONCLUSTERED ([name],[utilityTypeId]);

-- DropTable: the many-to-many mapping is replaced by the direct
-- AttributeType.utilityTypeId foreign key above.
DROP TABLE [dbo].[UtilityTypeAttributeType];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
