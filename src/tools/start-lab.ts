import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateLabId } from "../docker/exec.js";
import { resolveLabSource } from "../library/catalog.js";
import { fetchLabMetadata } from "../library/client.js";
import { ensureLabDownloaded } from "../labs/downloader.js";
import { allocatePort, releasePort } from "../labs/port-manager.js";
import {
  registerLab,
  unregisterLab,
  getRunningLab,
  getAllRunningLabs,
  isRunning,
} from "../labs/running-labs.js";
import { composeUp } from "../docker/compose.js";
import { waitForHealthy } from "../docker/health.js";
import { recordStart } from "../state/progress.js";
import { loadConfig } from "../state/config.js";
import { auditLog } from "../state/audit.js";

export function registerStartLab(server: McpServer): void {
  server.registerTool(
    "start_lab",
    {
      title: "Start Lab",
      description:
        "Download (if needed) and start a CTF lab. Returns the lab URL and mission briefing.",
      inputSchema: {
        labId: z
          .string()
          .describe("Lab identifier (e.g. sqli-01-the-leak)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ labId }) => {
      validateLabId(labId);

      // Idempotent: return existing lab if already running
      if (isRunning(labId)) {
        const existing = getRunningLab(labId)!;
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Lab "${labId}" is already running.`,
                "",
                `URL: ${existing.url}`,
                `Port: ${existing.port}`,
                `Started: ${existing.startedAt}`,
              ].join("\n"),
            },
          ],
        };
      }

      // Enforce concurrent lab limit
      const config = await loadConfig();
      const runningCount = getAllRunningLabs().length;
      if (runningCount >= config.preferences.maxConcurrentLabs) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Cannot start lab: ${runningCount} lab(s) already running (max ${config.preferences.maxConcurrentLabs}). Stop a running lab first.`,
            },
          ],
          isError: true,
        };
      }

      const resolved = await resolveLabSource(labId);
      if (!resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Lab "${labId}" not found. Run list_labs to see available labs.`,
            },
          ],
          isError: true,
        };
      }

      const metadata = await fetchLabMetadata(resolved.source.url, labId);
      const labDir = await ensureLabDownloaded(labId, resolved.source);
      const port = allocatePort(labId);

      let runningLab;
      try {
        runningLab = await composeUp(
          labDir,
          labId,
          port,
          resolved.source.name,
          metadata,
        );
        registerLab(runningLab);
      } catch (err) {
        releasePort(labId);
        unregisterLab(labId);
        throw err;
      }

      // Health check
      const healthPath = metadata.healthCheck?.path ?? "/";
      const healthUrl = `http://localhost:${port}${healthPath}`;
      const health = await waitForHealthy(healthUrl);

      await recordStart(labId);

      const lines = [
        `Lab "${metadata.name}" is running.`,
        "",
        `URL: ${runningLab.url}`,
        `Port: ${port}`,
        `Difficulty: ${metadata.difficulty}`,
        `DB Engine: ${metadata.dbEngine}`,
        "",
        `## Briefing`,
        metadata.briefing,
        "",
        `## Objective`,
        metadata.objective,
      ];

      if (!health.healthy) {
        lines.push(
          "",
          `Warning: Health check did not pass within ${health.elapsedMs}ms. The lab may still be starting.`,
        );
      } else {
        lines.push("", `Health check passed in ${health.elapsedMs}ms.`);
      }

      lines.push("", "Good luck, hacker.");

      await auditLog({ severity: "info", event: "lab_started", detail: `${labId} on port ${port}` });

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}
