import { open, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { TYPHON_HOME } from "../constants.js";

const LOCK_DIR = join(TYPHON_HOME, ".locks");
const held = new Map<string, Promise<void>>();

/**
 * Per-file async mutex using an in-process queue.
 *
 * Node's single-threaded model means the MCP server only runs one event
 * loop, so an in-process lock is sufficient to serialize read-modify-write
 * cycles. The lockfile on disk acts as a secondary guard for edge cases
 * where two processes share the same ~/.typhon directory.
 */
export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = filePath;

  // Queue behind any in-flight operation on the same file
  while (held.has(key)) {
    await held.get(key);
  }

  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  held.set(key, gate);

  try {
    await mkdir(LOCK_DIR, { recursive: true, mode: 0o700 });
    const lockPath = join(
      LOCK_DIR,
      filePath.replace(/[^a-zA-Z0-9._-]/g, "_") + ".lock",
    );
    const handle = await open(lockPath, "w", 0o600);
    try {
      return await fn();
    } finally {
      await handle.close();
    }
  } finally {
    held.delete(key);
    release();
  }
}
