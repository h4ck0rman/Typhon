import type { LabMetadata, HintsFile, Difficulty, Subcategory, DbEngine } from "./labs/schema.js";

// --- Running lab instance ---

export interface RunningLab {
  labId: string;
  libraryName: string;
  port: number;
  internalPort: number;
  url: string;
  composePath: string;
  flag: string;
  startedAt: string;
}

// --- Lab module from disk/cache ---

export interface LabModule {
  metadata: LabMetadata;
  hints: HintsFile;
  dir: string;
}

// --- Progress ---

export interface ProgressEntry {
  completed: boolean;
  completedAt: string | null;
  firstStartedAt: string | null;
  maxHintLevel: number;
  attempts: number;
}

export interface ProgressStore {
  version: number;
  labs: Record<string, ProgressEntry>;
}

// --- Feedback ---

export interface FeedbackEntry {
  labId: string | null;
  rating: number;
  comment: string | null;
  submittedAt: string;
}

export interface FeedbackStore {
  version: number;
  entries: FeedbackEntry[];
}

// --- Library ---

export interface LibrarySource {
  name: string;
  url: string;
  addedAt: string;
}

export interface LibraryManifest {
  typhonLibraryVersion: string;
  name: string;
  displayName: string;
  description: string;
  url: string;
  categories: string[];
  labCount: number;
  updatedAt: string;
}

export interface LabSummary {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  difficulty: string;
  description: string;
  tags: string[];
  dbEngine: string;
  author: string;
  version: string;
  _libraryName?: string;
}

export interface TyphonConfig {
  libraries: LibrarySource[];
  preferences: {
    maxConcurrentLabs: number;
  };
}

export interface CachedCatalog {
  libraryName: string;
  fetchedAt: number;
  labs: LabSummary[];
}

// --- Setup diagnostics ---

export interface SetupCheckResult {
  name: string;
  passed: boolean;
  message: string;
  fix?: string;
}

// --- Docker ---

export const CONTAINER_LIMITS = {
  memory: "512m",
  cpus: "1.0",
  pidsLimit: 256,
} as const;

export const PORT_RANGE = {
  min: 13370,
  max: 13399,
} as const;

export function toPublicMetadata(
  metadata: LabMetadata,
): Omit<LabMetadata, "flag"> {
  const { flag: _flag, ...publicFields } = metadata;
  return publicFields;
}

// Re-export schema types for convenience
export type { LabMetadata, HintsFile, Difficulty, Subcategory, DbEngine };
