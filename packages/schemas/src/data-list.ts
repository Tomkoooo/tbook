import { z } from "zod";
import { objectIdSchema } from "./common";

/**
 * A data list is an organization-owned table uploaded from a spreadsheet
 * (an employee roster, a member list, …). One column is the key; rules can
 * check a registration field against it (`in_list`), and other features can
 * read the rest of a row (name, company, email) by that key.
 */

export const dataListColumnSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(200),
});
export type DataListColumn = z.infer<typeof dataListColumnSchema>;

/** How keys are compared: what is stripped before matching a submitted value. */
export const dataListKeyNormalizations = ["trim_case", "digits_only", "alnum"] as const;
export const dataListKeyNormalizationSchema = z.enum(dataListKeyNormalizations);
export type DataListKeyNormalization = z.infer<typeof dataListKeyNormalizationSchema>;

export const dataListSchema = z.object({
  id: objectIdSchema,
  organizationId: objectIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  /** Column (from `columns`) whose value identifies a row. */
  keyColumn: z.string().min(1),
  keyNormalization: dataListKeyNormalizationSchema.default("trim_case"),
  /** Optional column holding an email address (lets emails target list rows). */
  emailColumn: z.string().nullable().default(null),
  /** Optional column holding a display name. */
  nameColumn: z.string().nullable().default(null),
  columns: z.array(dataListColumnSchema).default([]),
  rowCount: z.number().int().min(0).default(0),
  sourceFileName: z.string().default(""),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type DataList = z.infer<typeof dataListSchema>;

export const dataListRowSchema = z.object({
  id: objectIdSchema,
  organizationId: objectIdSchema,
  listId: objectIdSchema,
  /** The key column's value after normalization — what lookups match. */
  key: z.string().min(1),
  data: z.record(z.string(), z.string()).default({}),
});
export type DataListRow = z.infer<typeof dataListRowSchema>;
