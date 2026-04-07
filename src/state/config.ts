import { mkdir, readFile, writeFile, rename, readdir, unlink, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  TYPHON_HOME,
  CACHE_DIR,
  CONFIG_PATH,
  DEFAULT_LIBRARY_NAME,
  DEFAULT_LIBRARY_URL,
} from "../constants.js";
import type { TyphonConfig } from "../types.js";
import { TyphonConfigSchema } from "./schemas.js";
import { withFileLock } from "./file-lock.js";
import { auditLog } from "./audit.js";

export async function ensureTyphonHome(): Promise<void> {
  await mkdir(TYPHON_HOME, { recursive: true, mode: 0o700 });
  await mkdir(CACHE_DIR, { recursive: true, mode: 0o700 });

  // Clean up orphaned .tmp files from crashed atomic writes
  try {
    const entries = await readdir(TYPHON_HOME);
    for (const entry of entries) {
      if (entry.endsWith(".tmp")) {
        await unlink(join(TYPHON_HOME, entry)).catch(() => {});
      }
    }
  } catch {
    // Directory may not be readable yet
  }

  // Clean up orphaned temp directories/files in cache from crashed downloads
  try {
    const cacheEntries = await readdir(CACHE_DIR);
    for (const entry of cacheEntries) {
      const fullPath = join(CACHE_DIR, entry);
      if (entry.includes(".tmp")) {
        const info = await stat(fullPath).catch(() => null);
        if (info?.isDirectory()) {
          await rm(fullPath, { recursive: true, force: true }).catch(() => {});
        } else if (info?.isFile()) {
          await unlink(fullPath).catch(() => {});
        }
      }
      // Also scan inside library subdirectories
      const info = await stat(fullPath).catch(() => null);
      if (info?.isDirectory() && !entry.includes(".tmp")) {
        const subEntries = await readdir(fullPath).catch(() => []);
        for (const sub of subEntries) {
          if (sub.includes(".tmp-")) {
            await rm(join(fullPath, sub), { recursive: true, force: true }).catch(() => {});
          }
        }
      }
    }
  } catch {
    // Cache dir may not exist yet
  }
}

export function defaultConfig(): TyphonConfig {
  return {
    libraries: [
      {
        name: DEFAULT_LIBRARY_NAME,
        url: DEFAULT_LIBRARY_URL,
        addedAt: new Date().toISOString(),
      },
    ],
    preferences: {
      maxConcurrentLabs: 3,
    },
  };
}

export async function loadConfig(): Promise<TyphonConfig> {
  await ensureTyphonHome();
  return withFileLock(CONFIG_PATH, async () => {
    try {
      const raw = await readFile(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      const result = TyphonConfigSchema.safeParse(parsed);
      if (!result.success) {
        await auditLog({
          severity: "warn",
          event: "config_validation_failed",
          detail: result.error.message,
        });
        const config = defaultConfig();
        await atomicWrite(config);
        return config;
      }
      return result.data as TyphonConfig;
    } catch {
      const config = defaultConfig();
      await atomicWrite(config);
      return config;
    }
  });
}

export async function saveConfig(config: TyphonConfig): Promise<void> {
  await ensureTyphonHome();
  return withFileLock(CONFIG_PATH, async () => {
    const result = TyphonConfigSchema.safeParse(config);
    if (!result.success) {
      await auditLog({
        severity: "error",
        event: "config_save_validation_failed",
        detail: result.error.message,
      });
      throw new Error("Refusing to save invalid config");
    }
    await atomicWrite(config);
  });
}

async function atomicWrite(config: TyphonConfig): Promise<void> {
  const tmp = CONFIG_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(config, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  await rename(tmp, CONFIG_PATH);
}
