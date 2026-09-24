import type { ZodType, z } from "zod";
import { ActionError } from "./action-error";

/**
 * The one place every action validates its input, against the same Zod
 * schema from @tbook/schemas that also validates the equivalent
 * react-hook-form on the frontend — one schema, one source of truth.
 */
export function parseInput<T extends ZodType>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw ActionError.validation("Invalid input", result.error.flatten());
  }
  return result.data;
}
