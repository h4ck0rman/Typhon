import { z } from "zod";

export const Difficulty = z.enum(["apprentice", "practitioner", "expert"]);
export type Difficulty = z.infer<typeof Difficulty>;

export const DbEngine = z.enum(["mysql", "postgresql", "sqlite", "mssql"]);
export type DbEngine = z.infer<typeof DbEngine>;

export const Subcategory = z.enum([
  "basic",
  "auth-bypass",
  "error-based",
  "union",
  "blind-boolean",
  "blind-time",
  "stacked-queries",
  "order-by",
  "insert-update",
  "second-order",
  "polyglot",
  "routed",
  "oast",
  "file-access",
  "os-command",
  "waf-bypass",
]);
export type Subcategory = z.infer<typeof Subcategory>;

export const FlagDerivation = z.enum([
  "container-env",
  "file-read",
  "db-query",
]);
export type FlagDerivation = z.infer<typeof FlagDerivation>;

export const StaticFlagSchema = z.object({
  type: z.literal("static"),
  value: z.string().startsWith("TYPHON{").endsWith("}"),
});

export const DynamicFlagSchema = z.object({
  type: z.literal("dynamic"),
  derivation: FlagDerivation,
});

export const FlagSchema = z.discriminatedUnion("type", [
  StaticFlagSchema,
  DynamicFlagSchema,
]);

export const HealthCheckSchema = z.object({
  path: z.string()
    .regex(/^\/[a-zA-Z0-9/_.-]*$/, "Health check path must start with / and contain only safe URL characters")
    .default("/"),
  expectedStatus: z.number().int().min(100).max(599).default(200),
});

export const LAB_ID_REGEX = /^[a-z]+-\d{2}-[a-z0-9-]+$/;

export const LabMetadataSchema = z.object({
  id: z.string().regex(LAB_ID_REGEX, "Lab ID must be category-number-slug format using only lowercase, digits, and hyphens"),
  name: z.string(),
  category: z.enum(["sqli"]),
  subcategory: Subcategory,
  difficulty: Difficulty,
  description: z.string(),
  briefing: z.string(),
  objective: z.string(),
  tags: z.array(z.string()),
  dbEngine: DbEngine,
  appTheme: z.string(),
  internalPort: z.number().default(8080),
  flag: FlagSchema,
  healthCheck: HealthCheckSchema.default({}),
  youtubeUrl: z.string().url().nullable().default(null),
  estimatedMinutes: z.number().positive().optional(),
  prerequisites: z.array(z.string()).default([]),
  author: z.string().default("h4ck0rman"),
  version: z.string().default("1.0.0"),
});

export type LabMetadata = z.infer<typeof LabMetadataSchema>;

export const HintSchema = z.object({
  level: z.number().min(1).max(5),
  title: z.string(),
  content: z.string(),
});

export const HintsFileSchema = z.object({
  labId: z.string().regex(LAB_ID_REGEX, "Must match lab ID format"),
  hints: z.array(HintSchema).min(1),
});

export type HintsFile = z.infer<typeof HintsFileSchema>;
export type Hint = z.infer<typeof HintSchema>;
