import { readFile, writeFile, rename } from "node:fs/promises";
import { PROGRESS_PATH } from "../constants.js";
import type { ProgressStore, ProgressEntry } from "../types.js";
import { ProgressStoreSchema } from "./schemas.js";
import { withFileLock } from "./file-lock.js";
import { auditLog } from "./audit.js";
import { ensureTyphonHome } from "./config.js";

function emptyStore(): ProgressStore {
  return { version: 1, labs: {} };
}

function emptyEntry(): ProgressEntry {
  return {
    completed: false,
    completedAt: null,
    firstStartedAt: null,
    maxHintLevel: 0,
    attempts: 0,
  };
}

async function readStore(): Promise<ProgressStore> {
  try {
    const raw = await readFile(PROGRESS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const result = ProgressStoreSchema.safeParse(parsed);
    if (!result.success) {
      await auditLog({
        severity: "warn",
        event: "progress_validation_failed",
        detail: result.error.message,
      });
      return emptyStore();
    }
    return result.data as ProgressStore;
  } catch {
    return emptyStore();
  }
}

async function writeStore(store: ProgressStore): Promise<void> {
  await ensureTyphonHome();
  const tmp = PROGRESS_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(store, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  await rename(tmp, PROGRESS_PATH);
}

export async function loadProgress(): Promise<ProgressStore> {
  return withFileLock(PROGRESS_PATH, () => readStore());
}

export async function getLabProgress(
  labId: string,
): Promise<ProgressEntry | null> {
  return withFileLock(PROGRESS_PATH, async () => {
    const store = await readStore();
    return store.labs[labId] ?? null;
  });
}

export async function recordStart(labId: string): Promise<void> {
  return withFileLock(PROGRESS_PATH, async () => {
    const store = await readStore();
    const entry = store.labs[labId] ?? emptyEntry();
    if (!entry.firstStartedAt) {
      entry.firstStartedAt = new Date().toISOString();
    }
    store.labs[labId] = entry;
    await writeStore(store);
  });
}

export async function recordAttempt(labId: string): Promise<void> {
  return withFileLock(PROGRESS_PATH, async () => {
    const store = await readStore();
    const entry = store.labs[labId] ?? emptyEntry();
    entry.attempts += 1;
    store.labs[labId] = entry;
    await writeStore(store);
  });
}

export async function recordCompletion(labId: string): Promise<void> {
  return withFileLock(PROGRESS_PATH, async () => {
    const store = await readStore();
    const entry = store.labs[labId] ?? emptyEntry();
    entry.completed = true;
    entry.completedAt = new Date().toISOString();
    store.labs[labId] = entry;
    await writeStore(store);
  });
}

export async function recordHintUsed(
  labId: string,
  level: number,
): Promise<void> {
  return withFileLock(PROGRESS_PATH, async () => {
    const store = await readStore();
    const entry = store.labs[labId] ?? emptyEntry();
    entry.maxHintLevel = Math.max(entry.maxHintLevel, level);
    store.labs[labId] = entry;
    await writeStore(store);
  });
}
