import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { invalidateAllCaches, getCatalog } from "../library/catalog.js";
import { listLibraries } from "../library/registry.js";

export function registerRefreshCatalog(server: McpServer): void {
  server.registerTool(
    "refresh_catalog",
    {
      title: "Refresh Catalog",
      description:
        "Force re-fetch all lab catalogs from all configured libraries, ignoring cache.",
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      await invalidateAllCaches();
      const labs = await getCatalog(true);
      const libraries = await listLibraries();

      return {
        content: [
          {
            type: "text" as const,
            text: `Refreshed ${libraries.length} library source(s). ${labs.length} lab(s) available.`,
          },
        ],
      };
    },
  );
}
