BEGIN TRY

BEGIN TRAN;

-- Drop the old MM/DD/YYYY string timestamp column (superseded by the
-- already-backfilled timestampNew DateTime2 column added in the previous
-- migration).
ALTER TABLE [dbo].[Record] DROP COLUMN [timestamp];

-- Promote timestampNew to be the real timestamp column.
EXEC sp_rename N'dbo.Record.timestampNew', N'timestamp', 'COLUMN';

-- All existing rows were backfilled, so this is safe to make NOT NULL.
ALTER TABLE [dbo].[Record] ALTER COLUMN [timestamp] DATETIME2 NOT NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
