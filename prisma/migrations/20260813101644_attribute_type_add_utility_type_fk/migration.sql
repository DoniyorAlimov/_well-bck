BEGIN TRY

BEGIN TRAN;

-- DropIndex
ALTER TABLE [dbo].[AttributeType] DROP CONSTRAINT [AttributeType_name_key];

-- AlterTable
ALTER TABLE [dbo].[AttributeType] ADD [utilityTypeId] INT;

-- AddForeignKey
ALTER TABLE [dbo].[AttributeType] ADD CONSTRAINT [AttributeType_utilityTypeId_fkey] FOREIGN KEY ([utilityTypeId]) REFERENCES [dbo].[UtilityType]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
