import { readFile } from "node:fs/promises";
import { auditLog } from "../state/audit.js";

/**
 * Dangerous patterns that should never appear in a lab's docker-compose.yml.
 *
 * This is a defense-in-depth measure. Labs are fetched from curated libraries,
 * but a compromised library could inject dangerous Docker configurations.
 *
 * The validator uses two layers:
 * 1. Line-by-line key:value scanning for dangerous directives
 * 2. Structural analysis for volume mounts
 *
 * A full YAML parser would eliminate regex bypass risk but would require a
 * new dependency. The line-level approach handles the most common YAML
 * representations including quoted keys, boolean variants, and string values.
 */

// Match "true", "yes", "on" -- all YAML boolean truthy values, quoted or unquoted
const YAML_TRUE = `["']?(?:true|yes|on)["']?`;

const BLOCKED_PATTERNS: { pattern: RegExp; reason: string }[] = [
  // Container isolation escapes
  { pattern: new RegExp(`\\bprivileged\\s*:\\s*${YAML_TRUE}`, "im"), reason: "privileged mode grants full host access" },
  { pattern: /\bcap_add\s*:/im, reason: "extra Linux capabilities are not permitted" },
  { pattern: /\bnetwork_mode\s*:\s*["']?host["']?/im, reason: "host networking bypasses port isolation" },
  { pattern: /\bpid\s*:\s*["']?host["']?/im, reason: "host PID namespace breaks container isolation" },
  { pattern: /\bipc\s*:\s*["']?host["']?/im, reason: "host IPC namespace breaks container isolation" },
  { pattern: /\bsecurity_opt\s*:/im, reason: "security_opt can disable AppArmor/seccomp" },
  { pattern: /\buserns_mode\s*:/im, reason: "user namespace remapping not permitted" },
  { pattern: /\bdevices\s*:/im, reason: "host device passthrough is not permitted" },
  { pattern: /\bcgroup_parent\s*:/im, reason: "custom cgroup parent can escape isolation" },
  { pattern: /\bsysctls\s*:/im, reason: "kernel parameter modification is not permitted" },
  { pattern: /\bruntime\s*:/im, reason: "custom container runtime is not permitted" },

  // Dangerous specific mounts
  { pattern: /\/var\/run\/docker\.sock/i, reason: "Docker socket mount enables container escape" },
  { pattern: /\/etc\/shadow/i, reason: "shadow file mount is not permitted" },
  { pattern: /\/etc\/passwd/i, reason: "passwd file mount is not permitted" },
  { pattern: /\/proc\b/i, reason: "/proc mount is not permitted" },
  { pattern: /\/sys\b/i, reason: "/sys mount is not permitted" },
  { pattern: /\/dev\//i, reason: "/dev mount is not permitted" },
];

/**
 * Required patterns that a valid lab compose file must contain.
 */
const REQUIRED_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /^services\s*:/m, reason: "compose file must define at least one service" },
];

/**
 * Patterns that should be present for resource limit enforcement.
 * Labs are expected to reference TYPHON_* env vars for resource limits.
 * Missing patterns generate warnings, not hard errors.
 */
const RESOURCE_LIMIT_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /TYPHON_MEMORY|mem_limit|memory/i, name: "memory limit" },
  { pattern: /TYPHON_CPUS|cpus/i, name: "CPU limit" },
  { pattern: /TYPHON_PIDS_LIMIT|pids_limit/i, name: "PIDs limit" },
];

/**
 * Check for dangerous absolute host path volume mounts.
 * Blocks any bind mount with an absolute host path (starting with /).
 * Only relative paths (within the lab directory) and named volumes are allowed.
 *
 * Scans line-by-line for volume mount patterns:
 *   - /absolute/path:/container/path
 *   - "/absolute/path:/container/path"
 *   - '/absolute/path:/container/path'
 */
function checkHostVolumeMounts(content: string): string[] {
  const errors: string[] = [];
  const lines = content.split("\n");
  let inVolumesBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect volumes: key (service-level, not top-level named volumes)
    if (/^\s*volumes\s*:/.test(line)) {
      inVolumesBlock = true;
      continue;
    }

    // Exit volumes block when indentation decreases or new key appears
    if (inVolumesBlock && trimmed && !trimmed.startsWith("-") && !trimmed.startsWith("#")) {
      inVolumesBlock = false;
    }

    if (!inVolumesBlock) continue;
    if (!trimmed.startsWith("-")) continue;

    // Extract the volume value after "- "
    const volValue = trimmed.replace(/^-\s*/, "").replace(/^["']|["']$/g, "");

    // Block absolute host paths (bind mounts starting with /)
    if (volValue.startsWith("/")) {
      errors.push(`Blocked: host path volume mount "${volValue}" -- only relative paths and named volumes are allowed`);
    }
  }

  return errors;
}

export interface ComposeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export async function validateComposeFile(
  composePath: string,
): Promise<ComposeValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  let content: string;
  try {
    content = await readFile(composePath, "utf-8");
  } catch {
    return { valid: false, errors: ["Cannot read docker-compose.yml"], warnings: [] };
  }

  if (content.length > 100_000) {
    errors.push("Compose file exceeds 100KB size limit");
    return { valid: false, errors, warnings: [] };
  }

  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(content)) {
      errors.push(`Blocked: ${reason}`);
      await auditLog({
        severity: "error",
        event: "compose_blocked_pattern",
        detail: `${composePath}: ${reason}`,
      });
    }
  }

  for (const { pattern, reason } of REQUIRED_PATTERNS) {
    if (!pattern.test(content)) {
      errors.push(`Missing: ${reason}`);
    }
  }

  // Structural check for host volume mounts
  const volumeErrors = checkHostVolumeMounts(content);
  for (const volError of volumeErrors) {
    errors.push(volError);
    await auditLog({
      severity: "error",
      event: "compose_blocked_volume",
      detail: `${composePath}: ${volError}`,
    });
  }

  // Warn about missing resource limit references
  for (const { pattern, name } of RESOURCE_LIMIT_PATTERNS) {
    if (!pattern.test(content)) {
      const msg = `No ${name} reference found -- container may run with unlimited resources`;
      warnings.push(msg);
      await auditLog({
        severity: "warn",
        event: "compose_missing_resource_limit",
        detail: `${composePath}: ${msg}`,
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
