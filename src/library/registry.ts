import { rm } from "node:fs/promises";
import { join } from "node:path";
import { CACHE_DIR, DEFAULT_LIBRARY_NAME } from "../constants.js";
import { loadConfig, saveConfig } from "../state/config.js";
import { fetchManifest, fetchCatalog, validateLibraryName } from "./client.js";
import { auditLog } from "../state/audit.js";
import type { LibraryManifest, LibrarySource } from "../types.js";

export async function addLibrary(
  url: string,
): Promise<LibraryManifest> {
  const cleanUrl = url.replace(/\/+$/, "");
  const manifest = await fetchManifest(cleanUrl);

  const config = await loadConfig();
  const existing = config.libraries.find((lib) => lib.name === manifest.name);
  if (existing) {
    throw new Error(`Library "${manifest.name}" already exists`);
  }

  config.libraries.push({
    name: manifest.name,
    url: cleanUrl,
    addedAt: new Date().toISOString(),
  });
  await saveConfig(config);

  // Pre-cache the catalog
  try {
    await fetchCatalog(cleanUrl);
  } catch (err) {
    await auditLog({
      severity: "warn",
      event: "library_precache_failed",
      detail: `${manifest.name}: ${err instanceof Error ? err.message : "unknown error"}`,
    });
  }

  return manifest;
}

export async function removeLibrary(name: string): Promise<void> {
  validateLibraryName(name);

  if (name === DEFAULT_LIBRARY_NAME) {
    throw new Error("Cannot remove the default library");
  }

  const config = await loadConfig();
  const index = config.libraries.findIndex((lib) => lib.name === name);
  if (index === -1) {
    throw new Error(`Library "${name}" not found`);
  }

  config.libraries.splice(index, 1);
  await saveConfig(config);

  // Clean up cached data
  const catalogFile = join(CACHE_DIR, `catalog-${name}.json`);
  const cacheDir = join(CACHE_DIR, name);
  await rm(catalogFile, { force: true }).catch(() => {});
  await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
}

export async function listLibraries(): Promise<LibrarySource[]> {
  const config = await loadConfig();
  return config.libraries;
}
