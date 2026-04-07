import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { safeExec, validateLabId } from "./exec.js";
import { validateComposeFile } from "./compose-validator.js";
import { auditLog } from "../state/audit.js";
import { COMPOSE_PROJECT_PREFIX } from "../constants.js";
import { CONTAINER_LIMITS } from "../types.js";
import type { LabMetadata, RunningLab } from "../types.js";

export function deriveFlag(metadata: LabMetadata): string {
  if (metadata.flag.type === "static") {
    return metadata.flag.value;
  }
  const hash = randomUUID().replace(/-/g, "");
  return `TYPHON{${hash}}`;
}

export async function composeUp(
  labDir: string,
  labId: string,
  port: number,
  libraryName: string,
  metadata: LabMetadata,
): Promise<RunningLab> {
  validateLabId(labId);

  const composePath = join(labDir, "docker-compose.yml");
  await access(composePath);

  const validation = await validateComposeFile(composePath);
  if (!validation.valid) {
    await auditLog({
      severity: "error",
      event: "compose_validation_rejected",
      detail: `Lab "${labId}": ${validation.errors.join("; ")}`,
    });
    throw new Error(
      `Lab "${labId}" has an unsafe docker-compose.yml: ${validation.errors.join("; ")}`,
    );
  }

  const flag = deriveFlag(metadata);
  const projectName = COMPOSE_PROJECT_PREFIX + labId;

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    TYPHON_PORT: String(port),
    TYPHON_LAB_ID: labId,
    TYPHON_FLAG: flag,
    TYPHON_MEMORY: CONTAINER_LIMITS.memory,
    TYPHON_CPUS: CONTAINER_LIMITS.cpus,
    TYPHON_PIDS_LIMIT: String(CONTAINER_LIMITS.pidsLimit),
  };

  try {
    await safeExec(
      "docker",
      ["compose", "-f", composePath, "-p", projectName, "up", "-d", "--build"],
      { cwd: labDir, timeout: 120_000, env },
    );
  } catch (err) {
    await auditLog({
      severity: "error",
      event: "compose_up_failed",
      detail: `Lab "${labId}": ${err instanceof Error ? err.message : "unknown error"}`,
    });
    throw new Error(`Failed to start lab "${labId}". Check Docker is running and the lab package is valid.`);
  }

  return {
    labId,
    libraryName,
    port,
    internalPort: metadata.internalPort ?? 8080,
    url: `http://localhost:${port}`,
    composePath,
    flag,
    startedAt: new Date().toISOString(),
  };
}

export async function composeDown(
  labId: string,
  composePath: string,
): Promise<void> {
  validateLabId(labId);

  const projectName = COMPOSE_PROJECT_PREFIX + labId;
  try {
    await safeExec("docker", [
      "compose",
      "-f",
      composePath,
      "-p",
      projectName,
      "down",
      "--volumes",
      "--remove-orphans",
    ]);
  } catch (err) {
    await auditLog({
      severity: "error",
      event: "compose_down_failed",
      detail: `Lab "${labId}": ${err instanceof Error ? err.message : "unknown error"}`,
    });
    throw new Error(`Failed to stop lab "${labId}". Check Docker is running.`);
  }
}
