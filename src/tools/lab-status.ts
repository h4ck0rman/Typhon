import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAllRunningLabs } from "../labs/running-labs.js";

export function registerLabStatus(server: McpServer): void {
  server.registerTool(
    "lab_status",
    {
      title: "Lab Status",
      description:
        "Show all currently running labs with their URLs, uptime, and port assignments.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      const labs = getAllRunningLabs();

      if (labs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No labs are currently running. Use start_lab to launch one.",
            },
          ],
        };
      }

      const lines = [`${labs.length} lab(s) running:\n`];

      for (const lab of labs) {
        const uptimeMs = Date.now() - new Date(lab.startedAt).getTime();
        const uptimeMin = Math.round(uptimeMs / 60_000);
        lines.push(
          `  ${lab.labId}`,
          `    URL:     ${lab.url}`,
          `    Port:    ${lab.port}`,
          `    Source:  ${lab.libraryName}`,
          `    Uptime:  ${uptimeMin} minute(s)`,
          "",
        );
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}
