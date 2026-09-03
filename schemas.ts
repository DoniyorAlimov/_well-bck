import { z } from "zod";

export const assetSchema = z.object({
  name: z.string().min(1).max(255),
});

export const attributeSchema = z.object({
  name: z.string().min(1).max(255),
  assetId: z.number().min(1),
  attributeTypeId: z.number().min(1),
});

export const phdTagSchema = z.object({
  tagname: z.string().min(1).max(300),
  unitId: z.number().min(1),
});

export const unitSchema = z.object({
  name: z.string().min(1).max(255),
});

export const attributeTypeSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().min(1).max(255),
  unitId: z.number().nullable().optional(),
  utilityTypeId: z.number().min(1, "An asset type is required"),
});

export const assignmentSchema = z.object({
  attributeId: z.number().min(1),
  PHDTagId: z.number().min(1),
});

export const updateAssignmentSchema = z.object({
  PHDTagId: z.number().min(1),
});

export const dataSourceSchema = z.object({
  host: z.string().min(1).max(300),
  port: z.number().min(1),
});

export const userSchema = z.object({
  username: z.string().min(1).max(50),
  domainUsername: z.string().min(1).max(255),
  isAdmin: z.boolean(),
});

export const updateUserSchema = z.object({
  username: z.string().min(1).max(50),
  domainUsername: z.string().min(1).max(255),
  isAdmin: z.boolean(),
});

export const targetSchema = z.object({
  productionTarget: z.number(),
  energyConsumptionTarget: z.number(),
  specificEnergyConsupmtionTarget: z.number(),
  CO2EmissionTarget: z.number(),
  assetId: z.number().min(1),
});

export const updateTargetSchema = z.object({
  productionTarget: z.number().optional(),
  energyConsumptionTarget: z.number().optional(),
  specificEnergyConsupmtionTarget: z.number().optional(),
  CO2EmissionTarget: z.number().optional(),
});

export const updateConstantSchema = z.object({
  value: z.number(),
});

export const uploadTlsCertRequestSchema = z.object({
  pfxBase64: z.string().min(1),
  passphrase: z.string().min(1),
});
