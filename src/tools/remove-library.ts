import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { removeLibrary } from "../library/registry.js";
import { auditLog } from "../state/audit.js";

export function registerRemoveLibrary(server: McpServer): void {
  server.registerTool(
    "remove_library",
    {
      title: "Remove Library",
      description:
        "Remove a custom library source. The default library cannot be removed.",
      inputSchema: {
        name: z
          .string()
          .describe("Name of the library to remove"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ name }) => {
      try {
        await removeLibrary(name);
        await auditLog({ severity: "info", event: "library_removed", detail: name });
        return {
          content: [
            {
              type: "text" as const,
              text: `Removed library "${name}".`,
            },
          ],
        };
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to remove library: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
