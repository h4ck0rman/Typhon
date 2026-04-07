import {
  HEALTH_POLL_INTERVAL_MS,
  HEALTH_TIMEOUT_MS,
} from "../constants.js";
import { safeExec } from "./exec.js";
import type { SetupCheckResult } from "../types.js";

export async function waitForHealthy(
  url: string,
  options?: { pollIntervalMs?: number; timeoutMs?: number },
): Promise<{ healthy: boolean; elapsedMs: number }> {
  const interval = options?.pollIntervalMs ?? HEALTH_POLL_INTERVAL_MS;
  const timeout = options?.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        return { healthy: true, elapsedMs: Date.now() - start };
      }
    } catch {
      // Connection refused, timeout, etc. -- lab still starting
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return { healthy: false, elapsedMs: Date.now() - start };
}

export async function checkDockerAvailable(): Promise<SetupCheckResult[]> {
  const results: SetupCheckResult[] = [];

  // Check Docker daemon
  try {
    const { stdout } = await safeExec("docker", [
      "info",
      "--format",
      "{{.ServerVersion}}",
    ]);
    results.push({
      name: "Docker Engine",
      passed: true,
      message: `Docker ${stdout.trim()} is running`,
    });
  } catch {
    results.push({
      name: "Docker Engine",
      passed: false,
      message: "Docker is not running or not installed",
      fix: "Install Docker Desktop from https://docker.com/products/docker-desktop or start the Docker daemon",
    });
    return results; // No point checking compose if Docker itself is down
  }

  // Check Docker Compose v2
  try {
    const { stdout } = await safeExec("docker", [
      "compose",
      "version",
      "--short",
    ]);
    results.push({
      name: "Docker Compose",
      passed: true,
      message: `Docker Compose ${stdout.trim()} is available`,
    });
  } catch {
    results.push({
      name: "Docker Compose",
      passed: false,
      message: "Docker Compose v2 is not available",
      fix: "Update Docker Desktop (Compose v2 is included) or install docker-compose-plugin",
    });
  }

  return results;
}
