BEGIN TRY

BEGIN TRAN;

-- AlterTable: dataType was unconstrained free text, never read anywhere in
-- the app (attribute values always come through PHDTag -> Record.value as
-- Decimal), so it's dropped as pure unused metadata.
ALTER TABLE [dbo].[AttributeType] DROP COLUMN [dataType];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
