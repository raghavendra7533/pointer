import { z } from "zod";
import { LIMITS } from "./limits.ts";

export { LIMITS };

const rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const SelectionSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1).max(64),
    createdAt: z.string().max(40),
    page: z.object({
      url: z.string().max(2048),
      title: z.string().max(300),
      viewport: z.object({ w: z.number(), h: z.number() }),
      route: z.object({ file: z.string().max(300), inferred: z.boolean() }).optional(),
    }),
    element: z.object({
      tag: z.string().max(60),
      selector: z.string().max(1500),
      text: z.string().max(LIMITS.text),
      html: z.string().max(LIMITS.html + 64),
      attributes: z.record(z.string(), z.string().max(500)).refine((o) => Object.keys(o).length <= LIMITS.attributes),
      rect,
      styles: z.record(z.string(), z.string().max(300)).refine((o) => Object.keys(o).length <= LIMITS.styles),
      ancestors: z
        .array(z.object({ tag: z.string().max(60), classes: z.array(z.string().max(120)).max(12) }))
        .max(LIMITS.ancestors),
    }),
    source: z.object({
      framework: z.string().max(40),
      confidence: z.enum(["exact", "component-only", "none"]),
      components: z
        .array(
          z.object({
            name: z.string().max(120),
            file: z.string().max(500).optional(),
            line: z.number().int().nonnegative().optional(),
            column: z.number().int().nonnegative().optional(),
          }),
        )
        .max(LIMITS.components),
    }),
    screenshot: z
      .object({
        mime: z.enum(["image/png", "image/jpeg"]),
        base64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(Math.ceil((LIMITS.screenshotBytes * 4) / 3) + 8),
        w: z.number(),
        h: z.number(),
      })
      .optional(),
    userNote: z.string().max(LIMITS.note).optional(),
  })
  .strict();

export const SelectionSetSchema = z
  .object({ selections: z.array(SelectionSchema).min(1).max(LIMITS.maxSelections) })
  .strict();

export type SelectionSetInput = z.infer<typeof SelectionSetSchema>;
