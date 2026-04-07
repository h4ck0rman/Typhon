import { access } from "node:fs/promises";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { CACHE_DIR } from "../constants.js";
import { downloadPackage, validateLibraryName } from "../library/client.js";
import { validateLabId } from "../docker/exec.js";
import type { LibrarySource } from "../types.js";

export function getLabDir(labId: string, libraryName: string): string {
  validateLabId(labId);
  validateLibraryName(libraryName);
  return join(CACHE_DIR, libraryName, labId);
}

export async function ensureLabDownloaded(
  labId: string,
  source: LibrarySource,
): Promise<string> {
  const labDir = getLabDir(labId, source.name);
  const composePath = join(labDir, "docker-compose.yml");

  try {
    await access(composePath);
    return labDir; // Already downloaded
  } catch {
    // Not cached, download it
  }

  await downloadPackage(source.url, labId, labDir);

  // Verify extraction produced a docker-compose.yml
  try {
    await access(composePath);
  } catch {
    throw new Error(
      `Lab package for "${labId}" is missing docker-compose.yml`,
    );
  }

  return labDir;
}

export async function cleanLabCache(
  labId: string,
  libraryName: string,
): Promise<void> {
  await rm(getLabDir(labId, libraryName), { recursive: true, force: true });
}
