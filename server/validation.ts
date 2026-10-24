import { z } from 'zod';

// Zod 4 applies defaults inside optional fields. PATCH must retain omitted values.
export function parsePartial(schema: z.ZodObject<any>, input: unknown): Record<string, any> {
  const parsed = schema.partial().strict().parse(input);
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => Object.hasOwn(input as object, key)));
}
