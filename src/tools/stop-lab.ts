import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateLabId } from "../docker/exec.js";
import { getRunningLab, unregisterLab } from "../labs/running-labs.js";
import { releasePort } from "../labs/port-manager.js";
import { composeDown } from "../docker/compose.js";
import { auditLog } from "../state/audit.js";

export function registerStopLab(server: McpServer): void {
  server.registerTool(
    "stop_lab",
    {
      title: "Stop Lab",
      description: "Stop a running CTF lab and release its port.",
      inputSchema: {
        labId: z
          .string()
          .describe("Lab identifier (e.g. sqli-01-the-leak)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ labId }) => {
      validateLabId(labId);

      const lab = getRunningLab(labId);
      if (!lab) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Lab "${labId}" is not running.`,
            },
          ],
        };
      }

      await composeDown(labId, lab.composePath);
      releasePort(labId);
      unregisterLab(labId);
      await auditLog({ severity: "info", event: "lab_stopped", detail: labId });

      const uptimeMs =
        Date.now() - new Date(lab.startedAt).getTime();
      const uptimeMin = Math.round(uptimeMs / 60_000);

      return {
        content: [
          {
            type: "text" as const,
            text: `Lab "${labId}" stopped. Port ${lab.port} released. Session lasted ${uptimeMin} minute(s).`,
          },
        ],
      };
    },
  );
}
