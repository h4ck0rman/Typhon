import { readFile, writeFile, rename } from "node:fs/promises";
import { FEEDBACK_PATH } from "../constants.js";
import type { FeedbackStore, FeedbackEntry } from "../types.js";
import { FeedbackStoreSchema } from "./schemas.js";
import { withFileLock } from "./file-lock.js";
import { auditLog } from "./audit.js";
import { ensureTyphonHome } from "./config.js";

function emptyStore(): FeedbackStore {
  return { version: 1, entries: [] };
}

async function readStore(): Promise<FeedbackStore> {
  try {
    const raw = await readFile(FEEDBACK_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const result = FeedbackStoreSchema.safeParse(parsed);
    if (!result.success) {
      await auditLog({
        severity: "warn",
        event: "feedback_validation_failed",
        detail: result.error.message,
      });
      return emptyStore();
    }
    return result.data as FeedbackStore;
  } catch {
    return emptyStore();
  }
}

export async function loadFeedback(): Promise<FeedbackStore> {
  return withFileLock(FEEDBACK_PATH, () => readStore());
}

export async function appendFeedback(entry: FeedbackEntry): Promise<void> {
  await ensureTyphonHome();
  return withFileLock(FEEDBACK_PATH, async () => {
    const store = await readStore();
    store.entries.push(entry);
    const tmp = FEEDBACK_PATH + ".tmp";
    await writeFile(tmp, JSON.stringify(store, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    await rename(tmp, FEEDBACK_PATH);
  });
}
