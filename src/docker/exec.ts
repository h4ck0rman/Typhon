import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { LAB_ID_REGEX } from "../labs/schema.js";

const execFileAsync = promisify(execFileCb);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Safe wrapper around child_process.execFile.
 * Uses execFile (not exec) so arguments are passed as an array
 * with no shell interpretation -- preventing injection attacks.
 */
export async function safeExec(
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number }
): Promise<ExecResult> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options?.cwd,
    timeout: options?.timeout ?? 30_000,
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
}

/**
 * Validates a lab ID matches the expected safe pattern before
 * using it in any file path or Docker command context.
 */
export function validateLabId(labId: string): void {
  if (!LAB_ID_REGEX.test(labId)) {
    throw new Error(`Invalid lab ID: "${labId}". Must match pattern: category-number-slug (lowercase, digits, hyphens only)`);
  }
}
