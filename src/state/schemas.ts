import { z } from "zod";

export const LibrarySourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  addedAt: z.string(),
});

export const TyphonConfigSchema = z.object({
  libraries: z.array(LibrarySourceSchema).min(1),
  preferences: z.object({
    maxConcurrentLabs: z.number().int().min(1).max(10),
  }),
});

export const ProgressEntrySchema = z.object({
  completed: z.boolean(),
  completedAt: z.string().nullable(),
  firstStartedAt: z.string().nullable(),
  maxHintLevel: z.number().int().min(0),
  attempts: z.number().int().min(0),
});

export const ProgressStoreSchema = z.object({
  version: z.number().int(),
  labs: z.record(z.string(), ProgressEntrySchema),
});

export const FeedbackEntrySchema = z.object({
  labId: z.string().nullable(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).nullable(),
  submittedAt: z.string(),
});

export const FeedbackStoreSchema = z.object({
  version: z.number().int(),
  entries: z.array(FeedbackEntrySchema),
});
