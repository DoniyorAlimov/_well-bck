BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[UtilityTypeAttributeType] (
    [utilityTypeId] INT NOT NULL,
    [attributeTypeId] INT NOT NULL,
    CONSTRAINT [UtilityTypeAttributeType_pkey] PRIMARY KEY CLUSTERED ([utilityTypeId],[attributeTypeId])
);

-- AddForeignKey
ALTER TABLE [dbo].[UtilityTypeAttributeType] ADD CONSTRAINT [UtilityTypeAttributeType_utilityTypeId_fkey] FOREIGN KEY ([utilityTypeId]) REFERENCES [dbo].[UtilityType]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[UtilityTypeAttributeType] ADD CONSTRAINT [UtilityTypeAttributeType_attributeTypeId_fkey] FOREIGN KEY ([attributeTypeId]) REFERENCES [dbo].[AttributeType]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
