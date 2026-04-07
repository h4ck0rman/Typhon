import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addLibrary } from "../library/registry.js";
import { auditLog } from "../state/audit.js";

export function registerAddLibrary(server: McpServer): void {
  server.registerTool(
    "add_library",
    {
      title: "Add Library",
      description:
        "Add a custom CTF lab library source. The URL must serve a valid typhon-library.json manifest.",
      inputSchema: {
        url: z
          .string()
          .url()
          .describe(
            "Base URL of the library (e.g. https://my-library.example.com)",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ url }) => {
      try {
        const manifest = await addLibrary(url);
        await auditLog({ severity: "info", event: "library_added", detail: `${manifest.name} from ${url}` });
        return {
          content: [
            {
              type: "text" as const,
              text: `Added library "${manifest.displayName}" (${manifest.name}) with ${manifest.labCount} lab(s).`,
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
              text: `Failed to add library: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
