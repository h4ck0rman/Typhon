import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureTyphonHome } from "../state/config.js";
import { checkDockerAvailable } from "../docker/health.js";
import { rebuildPortMap, getActiveLabIds } from "../labs/port-manager.js";
import { TYPHON_HOME } from "../constants.js";

export function registerSetup(server: McpServer): void {
  server.registerTool(
    "setup",
    {
      title: "Check Setup",
      description:
        "Check if Docker and Docker Compose are available and properly configured for running CTF labs.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      await ensureTyphonHome();
      const checks = await checkDockerAvailable();
      await rebuildPortMap();
      const activeLabs = getActiveLabIds();

      const lines: string[] = [];
      let allPassed = true;

      for (const check of checks) {
        const icon = check.passed ? "[OK]" : "[FAIL]";
        lines.push(`${icon} ${check.name}: ${check.message}`);
        if (!check.passed) {
          allPassed = false;
          if (check.fix) {
            lines.push(`    Fix: ${check.fix}`);
          }
        }
      }

      lines.push("");
      lines.push(`Typhon home: ${TYPHON_HOME}`);
      if (activeLabs.length > 0) {
        lines.push(`Running labs detected: ${activeLabs.length}`);
      }

      if (allPassed) {
        lines.push("");
        lines.push("Typhon is ready. Use list_labs to browse available challenges.");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        isError: !allPassed,
      };
    },
  );
}
