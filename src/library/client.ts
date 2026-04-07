import { mkdir, writeFile, unlink, readdir, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { lookup } from "node:dns/promises";
import { createHash, randomBytes } from "node:crypto";
import { LabMetadataSchema, HintsFileSchema, LAB_ID_REGEX } from "../labs/schema.js";
import { safeExec, validateLabId } from "../docker/exec.js";
import { auditLog } from "../state/audit.js";
import type { LibraryManifest, LabSummary, LabMetadata, HintsFile } from "../types.js";

// --- URL Safety ---

export const LIBRARY_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function validateLibraryName(name: string): void {
  if (!LIBRARY_NAME_REGEX.test(name)) {
    throw new Error(
      `Invalid library name: "${name}". Must be lowercase alphanumeric, hyphens, underscores, max 64 chars.`,
    );
  }
}

/**
 * Parse an IPv4 address to a 32-bit number for range checks.
 * Returns null for non-IPv4 addresses.
 */
function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const octet = parseInt(part, 10);
    if (isNaN(octet) || octet < 0 || octet > 255) return null;
    num = (num << 8) | octet;
  }
  return num >>> 0;
}

/**
 * Check if an IP address falls in a private/reserved range.
 * Uses numeric comparison for IPv4 to prevent encoding bypasses.
 */
function isPrivateIp(addr: string): boolean {
  const normalized = addr.replace(/^::ffff:/i, "");
  const num = ipv4ToNumber(normalized);
  if (num !== null) {
    if ((num >>> 24) === 0) return true;       // 0.0.0.0/8
    if ((num >>> 24) === 10) return true;      // 10.0.0.0/8
    if ((num >>> 24) === 127) return true;     // 127.0.0.0/8
    if ((num >>> 16) === 0xa9fe) return true;  // 169.254.0.0/16
    if ((num >>> 20) === 0xac1) return true;   // 172.16.0.0/12
    if ((num >>> 16) === 0xc0a8) return true;  // 192.168.0.0/16
    if ((num >>> 22) === 0x191) return true;   // 100.64.0.0/10 (CGNAT)
    if ((num >>> 8) === 0xc00000) return true;  // 192.0.0.0/24
    if ((num >>> 17) === 0x6309) return true;  // 198.18.0.0/15
    if ((num >>> 28) === 0xf) return true;     // 240.0.0.0/4
    if (num === 0xffffffff) return true;        // 255.255.255.255
    return false;
  }
  const lower = addr.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower === "::") return true;
  return false;
}

/**
 * Validate a library URL for safety.
 *
 * Security model:
 * - HTTPS is required for non-localhost URLs. TLS certificate validation
 *   prevents MITM and provides server identity verification, making DNS
 *   rebinding ineffective (attacker cannot obtain a valid cert for our domain).
 * - HTTP is only allowed for localhost (development).
 * - DNS resolution is checked against private IP ranges to prevent SSRF.
 *   For HTTPS, we validate the resolved IP but use the original hostname
 *   in the fetch URL (required for TLS SNI/cert validation). This is safe
 *   because TLS binds the connection to the legitimate server.
 * - Redirects are blocked to prevent redirect-based SSRF.
 */
async function validateUrl(raw: string): Promise<void> {
  const parsed = new URL(raw);
  const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";

  if (parsed.protocol === "http:" && !isLocalhost) {
    await auditLog({ severity: "error", event: "http_blocked", detail: `Non-localhost HTTP URL: ${raw}` });
    throw new Error("Only HTTPS is allowed for non-localhost library URLs. Use https:// or localhost for development.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only HTTPS (or HTTP for localhost) library URLs are allowed");
  }

  // Validate resolved IP is not private (defense-in-depth for HTTPS, primary for HTTP)
  try {
    const result = await lookup(parsed.hostname);
    if (isPrivateIp(result.address) && !isLocalhost) {
      await auditLog({ severity: "error", event: "ssrf_blocked", detail: `${raw} resolved to ${result.address}` });
      throw new Error("Library URL resolves to a blocked internal address");
    }
  } catch (err) {
    if (err instanceof Error && (err.message.includes("blocked") || err.message.includes("Only HTTPS"))) throw err;
    throw new Error(`Cannot resolve hostname: ${parsed.hostname}`);
  }
}

// --- Fetch helpers ---

export class LibraryFetchError extends Error {
  constructor(
    public readonly url: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "LibraryFetchError";
  }
}

async function safeFetchJson<T>(
  url: string,
  timeoutMs = 10_000,
): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
  });
  if (!response.ok) {
    throw new LibraryFetchError(url, response.status, `HTTP ${response.status} fetching library resource`);
  }
  return (await response.json()) as T;
}

async function safeFetchBuffer(
  url: string,
  timeoutMs = 30_000,
  maxBytes = 100 * 1024 * 1024,
): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
  });
  if (!response.ok) {
    throw new LibraryFetchError(url, response.status, `HTTP ${response.status} fetching library resource`);
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new Error(`Package too large: ${contentLength} bytes (max ${maxBytes})`);
  }
  const ab = await response.arrayBuffer();
  if (ab.byteLength > maxBytes) {
    throw new Error(`Package too large: ${ab.byteLength} bytes (max ${maxBytes})`);
  }
  return Buffer.from(ab);
}

// --- Library API ---

export async function fetchManifest(
  baseUrl: string,
): Promise<LibraryManifest> {
  await validateUrl(baseUrl);
  const manifest = await safeFetchJson<LibraryManifest>(`${baseUrl}/typhon-library.json`);
  if (!manifest.name || typeof manifest.name !== "string") {
    throw new Error("Invalid library manifest: missing name");
  }
  validateLibraryName(manifest.name);
  if (manifest.typhonLibraryVersion !== "1") {
    throw new Error(`Unsupported library version: ${manifest.typhonLibraryVersion} (expected "1")`);
  }
  return manifest;
}

export async function fetchCatalog(baseUrl: string): Promise<LabSummary[]> {
  await validateUrl(baseUrl);
  const catalog = await safeFetchJson<LabSummary[]>(`${baseUrl}/index.json`);
  if (!Array.isArray(catalog)) {
    throw new Error("Invalid catalog: expected JSON array");
  }
  if (catalog.length > 10_000) {
    throw new Error(`Catalog too large: ${catalog.length} entries (max 10,000)`);
  }
  for (const lab of catalog) {
    if (!LAB_ID_REGEX.test(lab.id)) {
      throw new Error(`Invalid lab ID in catalog: "${lab.id}"`);
    }
  }
  return catalog;
}

export async function fetchLabMetadata(
  baseUrl: string,
  labId: string,
): Promise<LabMetadata> {
  validateLabId(labId);
  await validateUrl(baseUrl);
  const raw = await safeFetchJson(`${baseUrl}/labs/${labId}/lab.json`);
  return LabMetadataSchema.parse(raw);
}

export async function fetchHints(
  baseUrl: string,
  labId: string,
): Promise<HintsFile> {
  validateLabId(labId);
  await validateUrl(baseUrl);
  const raw = await safeFetchJson(`${baseUrl}/labs/${labId}/hints.json`);
  return HintsFileSchema.parse(raw);
}

// --- Package download with integrity verification + zip-slip protection ---

async function verifyNoPathEscape(dir: string): Promise<void> {
  const resolvedDir = await realpath(dir);
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    const entryPath = join(entry.parentPath ?? entry.path, entry.name);
    const resolvedEntry = await realpath(entryPath);
    if (!resolvedEntry.startsWith(resolvedDir)) {
      throw new Error(`Zip-slip detected: "${entry.name}" escapes extraction directory`);
    }
  }
}

/**
 * Pre-extraction: list tar contents and reject entries with path traversal.
 * Runs BEFORE extraction, closing the TOCTOU window for path-based attacks.
 */
async function verifyTarContents(tarPath: string): Promise<void> {
  const { stdout } = await safeExec("tar", ["tzf", tarPath]);
  for (const entry of stdout.split("\n")) {
    if (!entry.trim()) continue;
    if (entry.startsWith("/") || entry.includes("..")) {
      throw new Error(`Malicious tar entry detected: "${entry}"`);
    }
  }
}

/**
 * Compute SHA-256 hash of a buffer.
 */
function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Fetch the optional checksums manifest from a library.
 * Returns a map of labId -> SHA-256 hex digest, or null if not available.
 */
async function fetchChecksums(
  baseUrl: string,
): Promise<Record<string, string> | null> {
  try {
    return await safeFetchJson<Record<string, string>>(`${baseUrl}/checksums.json`);
  } catch {
    // Checksums file is optional for backwards compatibility
    return null;
  }
}

export async function downloadPackage(
  baseUrl: string,
  labId: string,
  destDir: string,
): Promise<string> {
  validateLabId(labId);
  await validateUrl(baseUrl);

  // Extract to a temp directory first. On success, move atomically.
  const tmpSuffix = randomBytes(8).toString("hex");
  const tmpDir = destDir + `.tmp-${tmpSuffix}`;
  await mkdir(tmpDir, { recursive: true, mode: 0o700 });

  try {
    const tarPath = join(tmpDir, "package.tar.gz");
    const buffer = await safeFetchBuffer(`${baseUrl}/labs/${labId}/package.tar.gz`);

    // Verify package integrity against checksums if available
    const checksums = await fetchChecksums(baseUrl);
    if (checksums && checksums[labId]) {
      const expected = checksums[labId].toLowerCase();
      const actual = sha256(buffer);
      if (actual !== expected) {
        await auditLog({
          severity: "error",
          event: "package_integrity_failed",
          detail: `Lab "${labId}": expected ${expected}, got ${actual}`,
        });
        throw new Error(`Package integrity check failed for "${labId}": hash mismatch`);
      }
    }

    await writeFile(tarPath, buffer);

    // Pre-extraction: verify tar contents
    await verifyTarContents(tarPath);

    await safeExec("tar", [
      "xzf", tarPath,
      "-C", tmpDir,
      "--no-same-owner",
      "--no-same-permissions",
    ]);
    await unlink(tarPath).catch(() => {});

    // Post-extraction: verify no symlink escapes
    await verifyNoPathEscape(tmpDir);

    // All checks passed: move to final destination
    await rm(destDir, { recursive: true, force: true });
    await rename(tmpDir, destDir);
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  return destDir;
}
