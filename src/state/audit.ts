import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { TYPHON_HOME } from "../constants.js";

const AUDIT_PATH = join(TYPHON_HOME, "audit.log");

export type AuditSeverity = "info" | "warn" | "error";

interface AuditEvent {
  severity: AuditSeverity;
  event: string;
  detail?: string;
}

/**
 * In-memory sequence counter and hash chain for tamper detection.
 * Each entry includes a SHA-256 hash of the previous entry, creating
 * a chain that reveals any deletion or modification of log lines.
 */
let lastHash = "0000000000000000000000000000000000000000000000000000000000000000";
let sequence = 0;
let initialized = false;

/**
 * Initialize the hash chain from the last line of the existing audit log.
 */
async function initChain(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const content = await readFile(AUDIT_PATH, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      const parsed = JSON.parse(lastLine);
      if (parsed.hash) {
        lastHash = parsed.hash;
      }
      if (typeof parsed.seq === "number") {
        sequence = parsed.seq;
      }
    }
  } catch {
    // No existing log or parse error -- start fresh
  }
}

function computeHash(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Append a security-relevant event to the audit log.
 * Each entry includes a sequence number and SHA-256 hash chain
 * linking it to the previous entry for tamper detection.
 *
 * Fire-and-forget safe -- errors are silently dropped so
 * audit logging never disrupts normal operation.
 */
export async function auditLog(entry: AuditEvent): Promise<void> {
  try {
    await mkdir(TYPHON_HOME, { recursive: true, mode: 0o700 });
    await initChain();

    sequence += 1;
    const timestamp = new Date().toISOString();
    const payload = JSON.stringify({
      ts: timestamp,
      seq: sequence,
      severity: entry.severity,
      event: entry.event,
      ...(entry.detail ? { detail: entry.detail } : {}),
      prev: lastHash,
    });

    const hash = computeHash(payload);
    const line = JSON.stringify({
      ts: timestamp,
      seq: sequence,
      severity: entry.severity,
      event: entry.event,
      ...(entry.detail ? { detail: entry.detail } : {}),
      prev: lastHash,
      hash,
    });

    lastHash = hash;

    await appendFile(AUDIT_PATH, line + "\n", {
      encoding: "utf-8",
      mode: 0o600,
    });
  } catch {
    // Audit logging must never throw
  }
}
