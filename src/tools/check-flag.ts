import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { timingSafeEqual, createHash } from "node:crypto";
import { validateLabId } from "../docker/exec.js";
import { getRunningLab } from "../labs/running-labs.js";
import { resolveLabSource } from "../library/catalog.js";
import { fetchLabMetadata } from "../library/client.js";
import { recordCompletion, recordAttempt } from "../state/progress.js";
import { auditLog } from "../state/audit.js";
import { flagRateLimiter } from "../state/rate-limit.js";

function safeCompare(a: string, b: string): boolean {
  // Hash both to fixed-length to avoid length oracle
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export function registerCheckFlag(server: McpServer): void {
  server.registerTool(
    "check_flag",
    {
      title: "Check Flag",
      description: "Submit a flag for a lab and check if it is correct.",
      inputSchema: {
        labId: z
          .string()
          .describe("Lab identifier (e.g. sqli-01-the-leak)"),
        flag: z.string().min(1).describe("The flag string to validate"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ labId, flag }) => {
      validateLabId(labId);

      if (!flagRateLimiter.check(labId)) {
        await auditLog({ severity: "warn", event: "flag_rate_limited", detail: labId });
        return {
          content: [
            {
              type: "text" as const,
              text: `Too many flag attempts for "${labId}". Wait a moment before trying again (max 10 per minute).`,
            },
          ],
          isError: true,
        };
      }

      let expectedFlag: string | null = null;

      // For running labs with dynamic flags, use the stored flag
      const running = getRunningLab(labId);
      if (running) {
        expectedFlag = running.flag;
      }

      // For static flags (or if lab is not running), fetch from metadata
      if (!expectedFlag) {
        const resolved = await resolveLabSource(labId);
        if (!resolved) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Lab "${labId}" not found.`,
              },
            ],
            isError: true,
          };
        }

        const metadata = await fetchLabMetadata(resolved.source.url, labId);
        if (metadata.flag.type === "static") {
          expectedFlag = metadata.flag.value;
        } else {
          return {
            content: [
              {
                type: "text" as const,
                text: `Lab "${labId}" uses dynamic flags. The lab must be running to check the flag. Use start_lab first.`,
              },
            ],
            isError: true,
          };
        }
      }

      await recordAttempt(labId);

      if (safeCompare(flag.trim(), expectedFlag)) {
        await recordCompletion(labId);
        await auditLog({ severity: "info", event: "flag_correct", detail: labId });
        return {
          content: [
            {
              type: "text" as const,
              text: [
                "Flag is correct!",
                "",
                `Lab: ${labId}`,
                "Status: COMPLETED",
                "",
                "Well done. Use list_labs to find your next challenge.",
              ].join("\n"),
            },
          ],
        };
      }

      await auditLog({ severity: "warn", event: "flag_incorrect", detail: labId });
      return {
        content: [
          {
            type: "text" as const,
            text: "Incorrect flag. Keep trying!",
          },
        ],
      };
    },
  );
}
