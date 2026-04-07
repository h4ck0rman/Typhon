import { readFile, writeFile, rename, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { CACHE_DIR, CATALOG_CACHE_TTL_MS } from "../constants.js";
import { loadConfig } from "../state/config.js";
import { fetchCatalog as fetchCatalogFromLibrary, validateLibraryName } from "./client.js";
import { auditLog } from "../state/audit.js";
import type {
  CachedCatalog,
  LabSummary,
  LibrarySource,
} from "../types.js";

function catalogPath(libraryName: string): string {
  validateLibraryName(libraryName);
  return join(CACHE_DIR, `catalog-${libraryName}.json`);
}

async function readCachedCatalog(
  libraryName: string,
): Promise<CachedCatalog | null> {
  try {
    const raw = await readFile(catalogPath(libraryName), "utf-8");
    return JSON.parse(raw) as CachedCatalog;
  } catch {
    return null;
  }
}

async function writeCachedCatalog(catalog: CachedCatalog): Promise<void> {
  const p = catalogPath(catalog.libraryName);
  const tmp = p + ".tmp";
  await writeFile(tmp, JSON.stringify(catalog, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  await rename(tmp, p);
}

function isFresh(catalog: CachedCatalog): boolean {
  return Date.now() - catalog.fetchedAt < CATALOG_CACHE_TTL_MS;
}

async function fetchAndCache(
  source: LibrarySource,
): Promise<LabSummary[]> {
  const labs = await fetchCatalogFromLibrary(source.url);
  const tagged = labs.map((lab) => ({ ...lab, _libraryName: source.name }));
  await writeCachedCatalog({
    libraryName: source.name,
    fetchedAt: Date.now(),
    labs: tagged,
  });
  return tagged;
}

export async function getCatalog(
  forceRefresh = false,
): Promise<LabSummary[]> {
  const config = await loadConfig();
  const allLabs: LabSummary[] = [];
  const seen = new Set<string>();

  for (const source of config.libraries) {
    let labs: LabSummary[] | null = null;

    if (!forceRefresh) {
      const cached = await readCachedCatalog(source.name);
      if (cached && isFresh(cached)) {
        labs = cached.labs;
      }
    }

    if (!labs) {
      try {
        labs = await fetchAndCache(source);
      } catch (err) {
        await auditLog({
          severity: "warn",
          event: "catalog_fetch_failed",
          detail: `Library "${source.name}": ${err instanceof Error ? err.message : "unknown error"}`,
        });
        // Fall back to stale cache on fetch failure
        const stale = await readCachedCatalog(source.name);
        if (stale) {
          labs = stale.labs;
        }
      }
    }

    if (labs) {
      for (const lab of labs) {
        if (!seen.has(lab.id)) {
          seen.add(lab.id);
          allLabs.push({ ...lab, _libraryName: source.name });
        }
      }
    }
  }

  return allLabs;
}

export async function resolveLabSource(
  labId: string,
): Promise<{ source: LibrarySource; summary: LabSummary } | null> {
  const config = await loadConfig();

  for (const source of config.libraries) {
    const cached = await readCachedCatalog(source.name);
    if (!cached) continue;
    const match = cached.labs.find((lab) => lab.id === labId);
    if (match) {
      return { source, summary: match };
    }
  }

  // Try fetching fresh catalogs if not found in cache
  for (const source of config.libraries) {
    try {
      const labs = await fetchAndCache(source);
      const match = labs.find((lab) => lab.id === labId);
      if (match) {
        return { source, summary: match };
      }
    } catch (err) {
      await auditLog({
        severity: "warn",
        event: "catalog_resolve_fetch_failed",
        detail: `Library "${source.name}": ${err instanceof Error ? err.message : "unknown error"}`,
      });
      continue;
    }
  }

  return null;
}

export async function invalidateAllCaches(): Promise<void> {
  try {
    const entries = await readdir(CACHE_DIR);
    for (const entry of entries) {
      if (entry.startsWith("catalog-") && entry.endsWith(".json")) {
        await unlink(join(CACHE_DIR, entry)).catch(() => {});
      }
    }
  } catch {
    // Cache dir may not exist yet
  }
}
