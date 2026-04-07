import { PORT_RANGE } from "../types.js";
import { COMPOSE_PROJECT_PREFIX } from "../constants.js";
import { safeExec } from "../docker/exec.js";
import { auditLog } from "../state/audit.js";

const activePorts = new Map<string, number>();

export function allocatePort(labId: string): number {
  const existing = activePorts.get(labId);
  if (existing !== undefined) return existing;

  const usedPorts = new Set(activePorts.values());
  for (let port = PORT_RANGE.min; port <= PORT_RANGE.max; port++) {
    if (!usedPorts.has(port)) {
      activePorts.set(labId, port);
      return port;
    }
  }

  throw new Error(
    `No ports available (all ${PORT_RANGE.max - PORT_RANGE.min + 1} ports in use)`,
  );
}

export function releasePort(labId: string): void {
  activePorts.delete(labId);
}

export function getPort(labId: string): number | undefined {
  return activePorts.get(labId);
}

export function getActiveLabIds(): string[] {
  return Array.from(activePorts.keys());
}

export async function rebuildPortMap(): Promise<void> {
  activePorts.clear();

  try {
    const { stdout } = await safeExec("docker", [
      "ps",
      "--format",
      "{{.Labels}}\t{{.Ports}}",
      "--filter",
      `label=${COMPOSE_PROJECT_PREFIX}lab-id`,
    ]);

    if (!stdout.trim()) return;

    for (const line of stdout.trim().split("\n")) {
      const [labels, ports] = line.split("\t");
      if (!labels || !ports) continue;

      const labIdMatch = labels.match(
        new RegExp(`${COMPOSE_PROJECT_PREFIX}lab-id=([a-z]+-\\d{2}-[a-z0-9-]+)`),
      );
      const portMatch = ports.match(/:(\d+)->/);

      if (labIdMatch && portMatch) {
        const labId = labIdMatch[1];
        const port = parseInt(portMatch[1], 10);
        if (port >= PORT_RANGE.min && port <= PORT_RANGE.max) {
          activePorts.set(labId, port);
        }
      }
    }
  } catch (err) {
    await auditLog({
      severity: "warn",
      event: "port_map_rebuild_failed",
      detail: err instanceof Error ? err.message : "unknown error",
    });
  }
}
