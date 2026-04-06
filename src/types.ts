import type { LabMetadata, HintsFile } from "./labs/schema.js";

export interface RunningLab {
  labId: string;
  port: number;
  internalPort: number;
  url: string;
  startedAt: Date;
  lastAccessedAt: Date;
  containerId?: string;
}

export interface LabModule {
  metadata: LabMetadata;
  hints: HintsFile;
  dir: string;
}

export interface ProgressEntry {
  completed: boolean;
  completedAt: string | null;
  hintsUsed: number;
  attempts: number;
}

export interface ProgressStore {
  version: number;
  labs: Record<string, ProgressEntry>;
}

export interface FeedbackEntry {
  labId: string | null;
  rating: number;
  comment: string | null;
  timestamp: string;
}

export interface SetupCheckResult {
  name: string;
  passed: boolean;
  message: string;
  fix?: string;
}

export const CONTAINER_LIMITS = {
  memory: "512m",
  cpus: "1.0",
  pidsLimit: 256,
  network: "bridge",
  readOnlyRoot: false,
} as const;

/**
 * Strips the flag field from lab metadata so it is never
 * exposed to the MCP client in tool responses.
 */
export function toPublicMetadata(
  metadata: LabMetadata
): Omit<LabMetadata, "flag"> {
  const { flag: _flag, ...publicFields } = metadata;
  return publicFields;
}

export const PORT_RANGE = {
  min: 13370,
  max: 13399,
} as const;
